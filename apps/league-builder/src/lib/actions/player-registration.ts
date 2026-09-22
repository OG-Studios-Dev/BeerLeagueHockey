/**
 * Player Registration Server Actions
 *
 * Server actions for the player registration flow:
 * - Draft management (save, get, delete)
 * - Photo upload/delete
 * - Waiver signing
 * - Payment processing
 * - Registration submission
 * - Admin approval workflow
 *
 * Security:
 * - All actions verify user authentication
 * - Players can only manage their own registrations
 * - Admins can manage registrations for their leagues
 * - Uses RLS policies for additional protection
 */

'use server';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type {
  RegistrationFormData,
  RegistrationDraftData,
} from '@/lib/schemas/player-registration';
import type { Database } from '@hockey-life/database';
import Stripe from 'stripe';
import {
  sendRegistrationSubmittedEmail,
  sendRegistrationApprovedEmail,
  sendRegistrationRejectedEmail,
  notifyLeagueAdminsOfNewRegistration,
} from '@/lib/email/registration-emails';
import { createPaymentIntent } from '@/lib/leagues/stripe-connect';
import {
  getRegistrationPaymentMode,
  getPlayerRegistrationFeeAmount,
  getSeasonPaymentSettings,
  isPlayerFeeConfigurationMissing,
  usesTeamBilling,
} from '@/lib/payments/fee-collection-model';
import {
  recalculateTeamInvoiceForTeam,
  updateFlatTeamContributionTarget,
} from '@/lib/payments/team-contributions';
import { getLeagueBillingConfig } from '@/lib/fees/platform-fees';
import { reconcileSeasonRegistrationFees } from '@/lib/payments/registration-fee-reconciliation';
import { verifyLeagueOwnerAccess } from './permissions';
import { profileImageExtension } from '@/lib/profile-image-mime';

let _stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (_stripe) return _stripe;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  }

  _stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2026-01-28.clover',
    typescript: true,
  });

  return _stripe;
}

// ============================================================================
// Types
// ============================================================================

type ActionResult<T = void> = Promise<
  | { success: true; data?: T }
  | { success: false; error: string }
>;

interface RegistrationSubmissionResult {
  registrationId: string;
  status: string;
  requiresPayment: boolean;
}

interface LeagueWaiver {
  id: string;
  content: string;
  version: string;
  content_hash: string;
  title: string;
  document_url: string | null;
  document_name: string | null;
  document_mime_type: string | null;
}

interface PendingRegistration {
  id: string;
  player_id: string;
  league_id: string;
  season_id: string;
  team_id: string | null;
  registration_type: string;
  draft_data: {
    registration_intent?: string | null;
    requested_team_name?: string | null;
    previous_team_name?: string | null;
    team_return_status?: string | null;
    date_of_birth?: string | null;
    phone?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    emergency_contact_relationship?: string | null;
    medical_notes?: string | null;
  } | null;
  status: string;
  preferred_position: string | null;
  secondary_position: string | null;
  preferred_jersey_number: number | null;
  self_assessed_skill: string | null;
  years_experience: number | null;
  previous_leagues: string | null;
  photo_url: string | null;
  payment_status: string;
  fee_amount_cents: number | null;
  amount_paid_cents: number;
  currency: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  player: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    avatar_url?: string | null;
    photo_url?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    emergency_contact_relationship?: string | null;
    medical_notes?: string | null;
  };
  team: {
    id: string;
    name: string;
  } | null;
  waiver: {
    id: string;
    signed_name: string;
    agreed_at: string;
  } | null;
}

interface WaiverFallbackRecord {
  id: string;
  player_id: string;
  season_id: string | null;
  signed_name: string;
  agreed_at: string | null;
}

function normalizeWaiverSignature(input: {
  signatureType?: 'drawn' | 'typed' | 'checkbox';
  signatureData?: string;
  signedName?: string;
  fallbackName?: string;
}) {
  const signedName = (input.signedName || input.fallbackName || '').trim();

  if (input.signatureType === 'drawn') {
    return {
      signatureType: 'drawn' as const,
      signatureData: input.signatureData || signedName || 'signed',
      signedName,
    };
  }

  return {
    signatureType: 'typed' as const,
    signatureData: signedName || input.signatureData || 'Waiver accepted',
    signedName,
  };
}

function normalizeRegistrationPosition(
  position?: string | null
): 'Forward' | 'Defense' | 'Goalie' | null {
  if (!position) return null;

  switch (position.trim().toUpperCase()) {
    case 'C':
    case 'LW':
    case 'RW':
    case 'F':
    case 'FORWARD':
      return 'Forward';
    case 'D':
    case 'DEF':
    case 'DEFENSE':
      return 'Defense';
    case 'G':
    case 'GOALIE':
      return 'Goalie';
    default:
      return null;
  }
}

function normalizeRegistrationSkillLevel(
  skillLevel?: string | null
): 'beginner' | 'intermediate' | 'advanced' | 'expert' | null {
  if (!skillLevel) return null;

  switch (skillLevel.trim().toLowerCase()) {
    case 'beginner':
    case 'novice':
      return 'beginner';
    case 'intermediate':
      return 'intermediate';
    case 'advanced':
      return 'advanced';
    case 'expert':
      return 'expert';
    default:
      return null;
  }
}

async function persistCanonicalRegistrationConsents(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  emailMarketingOptIn: boolean
) {
  const consents = [
    { consent_type: 'terms_v1', granted: true },
    { consent_type: 'privacy_v1', granted: true },
    { consent_type: 'marketing_emails', granted: emailMarketingOptIn },
  ] as const;

  for (const consent of consents) {
    const { data: existing } = await serviceSupabase
      .from('user_consents')
      .select('id')
      .eq('user_id', userId)
      .eq('consent_type', consent.consent_type)
      .maybeSingle();

    if (existing?.id) {
      await serviceSupabase
        .from('user_consents')
        .update({
          granted: consent.granted,
          granted_at: new Date().toISOString(),
          withdrawn_at: consent.granted ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await serviceSupabase.from('user_consents').insert({
        user_id: userId,
        consent_type: consent.consent_type,
        granted: consent.granted,
        granted_at: new Date().toISOString(),
      });
    }
  }
}

type OfflineRegistrationPaymentMethod =
  | 'e_transfer'
  | 'cash'
  | 'check'
  | 'other';

function buildRegistrationPaymentStatus(
  feeAmountCents: number,
  amountPaidCents: number,
  currentStatus: string | null
) {
  if (currentStatus === 'not_required' || feeAmountCents <= 0) {
    return 'not_required';
  }

  if (amountPaidCents >= feeAmountCents) {
    return 'completed';
  }

  if (amountPaidCents > 0) {
    return 'pending';
  }

  return currentStatus || 'pending';
}

// ============================================================================
// Helper: Get Current User
// ============================================================================

async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

// ============================================================================
// Helper: Verify League Admin Access
// ============================================================================

async function verifyLeagueAdminAccess(leagueId: string) {
  const access = await verifyLeagueOwnerAccess(leagueId);
  if (!access.authorized) {
    return {
      error:
        access.error ||
        'Only league owners and admins can manage registrations.',
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Authentication required. Please sign in.' };
  }

  return { userId: user.id };
}

async function attachWaiverFallbackToRegistrations(
  leagueId: string,
  registrations: PendingRegistration[]
): Promise<PendingRegistration[]> {
  const missingWaiverRegistrations = registrations.filter((registration) => !registration.waiver);

  if (missingWaiverRegistrations.length === 0) {
    return registrations;
  }

  const playerIds = Array.from(
    new Set(missingWaiverRegistrations.map((registration) => registration.player_id))
  );

  if (playerIds.length === 0) {
    return registrations;
  }

  const supabase = createServiceRoleClient();
  const { data: waiverRows, error } = await supabase
    .from('player_waivers')
    .select('id, player_id, season_id, signed_name, agreed_at')
    .eq('league_id', leagueId)
    .in('player_id', playerIds)
    .order('agreed_at', { ascending: false });

  if (error || !waiverRows) {
    if (error) {
      console.error('Attach waiver fallback error:', error);
    }
    return registrations;
  }

  const waiversByPlayer = new Map<string, WaiverFallbackRecord[]>();
  for (const row of waiverRows as WaiverFallbackRecord[]) {
    const existing = waiversByPlayer.get(row.player_id) || [];
    existing.push(row);
    waiversByPlayer.set(row.player_id, existing);
  }

  return registrations.map((registration) => {
    if (registration.waiver) {
      return registration;
    }

    const playerWaivers = waiversByPlayer.get(registration.player_id) || [];
    const seasonSpecific =
      playerWaivers.find((waiver) => waiver.season_id === registration.season_id) || null;
    const leagueWide = playerWaivers.find((waiver) => waiver.season_id === null) || null;
    const fallbackWaiver = seasonSpecific || leagueWide;

    if (!fallbackWaiver) {
      return registration;
    }

    return {
      ...registration,
      waiver: {
        id: fallbackWaiver.id,
        signed_name: fallbackWaiver.signed_name,
        agreed_at: fallbackWaiver.agreed_at || '',
      },
    };
  });
}

// ============================================================================
// 1. Draft Management
// ============================================================================

/**
 * Save registration draft for later completion
 */
export async function saveRegistrationDraft(
  leagueId: string,
  seasonId: string,
  data: Partial<RegistrationDraftData>
): ActionResult<{ draftId: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in to save your progress.' };
    }

    const supabase = await createClient();
    const serviceSupabase = createServiceRoleClient();
    const paymentSettings = await getSeasonPaymentSettings(
      serviceSupabase as any,
      leagueId,
      seasonId
    );
    const playerFeeAmountCents = getPlayerRegistrationFeeAmount(
      paymentSettings.feeBasis,
      paymentSettings.feeAmountCents
    );
    if (
      isPlayerFeeConfigurationMissing(
        paymentSettings.feeCollectionModel,
        paymentSettings.feeAmountCents,
        paymentSettings.feeBasis
      )
    ) {
      return {
        success: false,
        error:
          'Registration is not open yet. The league still needs to configure the player registration fee for this season.',
      };
    }

    const paymentMode = getRegistrationPaymentMode(
      paymentSettings.feeCollectionModel,
      paymentSettings.feeAmountCents,
      paymentSettings.feeBasis
    );
    const normalizedPaymentStatus =
      data.payment_status === 'completed'
        ? 'completed'
        : paymentMode === 'required'
          ? 'pending'
          : 'not_required';
    const amountPaidCents =
      normalizedPaymentStatus === 'completed' ? playerFeeAmountCents : 0;
    const normalizedDraftData = {
      ...data,
      payment_status: normalizedPaymentStatus,
      amount_cents: amountPaidCents,
    };

    // Upsert the draft (update if exists, insert if not)
    // Note: registration_submissions table is defined in migrations but not in generated types yet
    const { data: registration, error } = await (supabase
      .from as any)('registration_submissions')
      .upsert(
        {
          player_id: user.id,
          league_id: leagueId,
          season_id: seasonId,
          registration_type: data.registration_type || 'free_agent',
          team_id: data.team_id || null,
          draft_data: normalizedDraftData,
          draft_step: data.current_step || 1,
          status: 'pending',
          payment_status: normalizedPaymentStatus,
          fee_amount_cents: playerFeeAmountCents,
          amount_paid_cents: amountPaidCents,
          currency: paymentSettings.currency,
        },
        {
          onConflict: 'player_id,league_id,season_id',
        }
      )
      .select('id')
      .single() as { data: { id: string } | null; error: any };

    if (error || !registration) {
      console.error('Save draft error:', error);
      return { success: false, error: 'Failed to save progress.' };
    }

    return { success: true, data: { draftId: registration!.id } };
  } catch (error) {
    console.error('Save draft error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Get existing registration draft
 */
export async function getRegistrationDraft(
  leagueId: string,
  seasonId: string
): ActionResult<RegistrationDraftData | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    // Note: registration_submissions table is defined in migrations but not in generated types yet
    const { data: registration, error } = await (supabase
      .from as any)('registration_submissions')
      .select('draft_data, draft_step, status, submitted_at')
      .eq('player_id', user.id)
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .single() as { data: { draft_data: any; draft_step: number; status: string; submitted_at: string | null } | null; error: any };

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - no draft exists
        return { success: true, data: null };
      }
      console.error('Get draft error:', error);
      return { success: false, error: 'Failed to load progress.' };
    }

    // If registration is already submitted, don't return draft
    if (!registration || registration.status !== 'pending' || registration.submitted_at) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        ...registration.draft_data,
        current_step: registration.draft_step,
      } as RegistrationDraftData,
    };
  } catch (error) {
    console.error('Get draft error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Delete registration draft
 */
export async function deleteRegistrationDraft(
  leagueId: string,
  seasonId: string
): ActionResult {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from('registration_submissions')
      .delete()
      .eq('player_id', user.id)
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .eq('status', 'pending')
      .is('submitted_at', null);

    if (error) {
      console.error('Delete draft error:', error);
      return { success: false, error: 'Failed to delete draft.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete draft error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

// ============================================================================
// 2. Photo Upload
// ============================================================================

/**
 * Upload player profile photo
 */
export async function uploadPlayerPhoto(
  file: File
): ActionResult<{ url: string; path: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    // Validate file
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return { success: false, error: 'File size must be less than 5MB.' };
    }

    const canonicalExtension = profileImageExtension(file.type);
    if (!canonicalExtension) {
      return {
        success: false,
        error: 'Please upload a valid image (PNG, JPG, or WebP).',
      };
    }

    const supabase = await createClient();

    // Generate unique filename
    const filename = `${user.id}/${Date.now()}.${canonicalExtension}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('player-photos')
      .upload(filename, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return { success: false, error: 'Failed to upload photo.' };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('player-photos')
      .getPublicUrl(uploadData.path);

    return {
      success: true,
      data: {
        url: urlData.publicUrl,
        path: uploadData.path,
      },
    };
  } catch (error) {
    console.error('Upload photo error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Delete player profile photo
 */
export async function deletePlayerPhoto(path: string): ActionResult {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    // Verify the path belongs to the user
    if (!path.startsWith(`${user.id}/`)) {
      return { success: false, error: 'You can only delete your own photos.' };
    }

    const supabase = await createClient();

    const { error } = await supabase.storage
      .from('player-photos')
      .remove([path]);

    if (error) {
      console.error('Delete photo error:', error);
      return { success: false, error: 'Failed to delete photo.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete photo error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

// ============================================================================
// 3. Waiver Management
// ============================================================================

/**
 * Get active waiver template for a league
 */
export async function getLeagueWaiver(
  leagueId: string
): ActionResult<LeagueWaiver | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    const { data: waiver, error } = await supabase
      .from('league_waiver_templates')
      .select('id, content, version, content_hash, title, document_url, document_name, document_mime_type')
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No waiver template exists - use default
        return { success: true, data: null };
      }
      console.error('Get waiver error:', error);
      return { success: false, error: 'Failed to load waiver.' };
    }

    return { success: true, data: waiver };
  } catch (error) {
    console.error('Get waiver error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Submit signed waiver
 */
export async function submitSignedWaiver(
  leagueId: string,
  seasonId: string,
  signatureData: string,
  signatureType: 'drawn' | 'typed' | 'checkbox',
  signedName: string,
  waiverContentHash: string
): ActionResult<{ waiverId: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    // Get waiver version
    const { data: template } = await supabase
      .from('league_waiver_templates')
      .select('version')
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .single();

    const { data: waiver, error } = await supabase
      .from('player_waivers')
      .insert({
        player_id: user.id,
        league_id: leagueId,
        season_id: seasonId,
        signature_data: signatureData,
        signature_type: signatureType as any, // 'checkbox' added via migration, types not yet regenerated
        signed_name: signedName,
        waiver_version: template?.version || 'v1',
        waiver_content_hash: waiverContentHash,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Submit waiver error:', error);
      return { success: false, error: 'Failed to save waiver signature.' };
    }

    return { success: true, data: { waiverId: waiver.id } };
  } catch (error) {
    console.error('Submit waiver error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

// ============================================================================
// 4. Payment
// ============================================================================

/**
 * Create payment intent for registration fee
 */
export async function createRegistrationPaymentIntent(
  leagueId: string,
  seasonId: string,
  amountCents: number
): ActionResult<{ paymentIntentId: string; clientSecret: string; amount: number }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();
    const paymentSettings = await getSeasonPaymentSettings(
      createServiceRoleClient() as any,
      leagueId,
      seasonId
    );
    const playerFeeAmountCents = getPlayerRegistrationFeeAmount(
      paymentSettings.feeBasis,
      paymentSettings.feeAmountCents
    );
    const paymentMode = getRegistrationPaymentMode(
      paymentSettings.feeCollectionModel,
      paymentSettings.feeAmountCents,
      paymentSettings.feeBasis
    );

    if (paymentMode === 'hidden') {
      return {
        success: false,
        error: usesTeamBilling(paymentSettings.feeCollectionModel, paymentSettings.feeBasis)
          ? 'This season uses team billing, so individual player payment is not required.'
          : 'This season does not currently have an individual player fee configured.',
      };
    }

    const amountToCharge =
      playerFeeAmountCents > 0 ? playerFeeAmountCents : amountCents;

    if (amountToCharge <= 0) {
      return {
        success: false,
        error: 'This registration does not currently require an individual payment.',
      };
    }

    // 1. Get league's Stripe Connect account
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, name, stripe_account_id, stripe_account_status')
      .eq('id', leagueId)
      .single();

    if (leagueError || !league) {
      return { success: false, error: 'League not found.' };
    }

    if (!league.stripe_account_id) {
      return {
        success: false,
        error: 'This league has not set up payment processing yet. Please contact the league administrator.',
      };
    }

    if (league.stripe_account_status !== 'complete') {
      return {
        success: false,
        error: 'The league payment account is not fully set up. Please contact the league administrator.',
      };
    }

    // 2. Get user email for receipt
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', user.id)
      .single();

    // 3. Get season name for description
    const { data: season } = await supabase
      .from('seasons')
      .select('name')
      .eq('id', seasonId)
      .single();

    // 4. Create PaymentIntent with Stripe Connect
    const paymentResult = await createPaymentIntent({
      leagueId,
      connectedAccountId: league.stripe_account_id,
      amountCents: amountToCharge,
      currency: paymentSettings.currency,
      description: `Registration fee for ${season?.name || 'season'} - ${league.name}`,
      customerEmail: profile?.email || user.email,
      metadata: {
        type: 'registration',
        league_id: leagueId,
        season_id: seasonId,
        player_id: user.id,
        player_name: profile?.full_name || 'Unknown',
      },
    });

    return {
      success: true,
      data: {
        paymentIntentId: paymentResult.paymentIntentId,
        clientSecret: paymentResult.clientSecret,
        amount: paymentResult.amount,
      },
    };
  } catch (error) {
    console.error('Create payment intent error:', error);
    return { success: false, error: 'Failed to initialize payment. Please try again.' };
  }
}

/**
 * Confirm registration payment after Stripe Elements completion
 * This is called after the payment is successfully processed on the client
 */
export async function confirmRegistrationPayment(
  registrationId: string,
  paymentIntentId: string,
  amountPaidCents?: number
): ActionResult {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    // Get the registration to verify ownership and get league_id
    const { data: registration, error: regError } = await supabase
      .from('registration_submissions')
      .select('id, player_id, league_id, currency')
      .eq('id', registrationId)
      .eq('player_id', user.id)
      .single();

    if (regError || !registration) {
      return { success: false, error: 'Registration not found.' };
    }

    // Update registration with payment status
    const { error } = await supabase
      .from('registration_submissions')
      .update({
        payment_status: 'completed',
        stripe_payment_intent_id: paymentIntentId,
        amount_paid_cents: amountPaidCents || 0,
      })
      .eq('id', registrationId)
      .eq('player_id', user.id);

    if (error) {
      console.error('Confirm payment error:', error);
      return { success: false, error: 'Failed to confirm payment.' };
    }

    // Log to stripe_connect_payments table for league's payment tracking
    const serviceClient = createServiceRoleClient();
    await serviceClient.from('stripe_connect_payments').insert({
      league_id: registration.league_id,
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: amountPaidCents || 0,
      application_fee_cents: 0,
      currency: registration.currency || 'cad',
      status: 'succeeded',
      description: `Registration payment`,
      customer_email: user.email,
      metadata: {
        type: 'registration',
        registration_id: registrationId,
        player_id: user.id,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Confirm payment error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

// ============================================================================
// 5. Registration Submission
// ============================================================================

/**
 * Submit final registration
 */
export async function submitPlayerRegistration(
  data: RegistrationFormData
): ActionResult<RegistrationSubmissionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in to register.' };
    }

    const serviceSupabase = createServiceRoleClient();
    const tosAccepted = (data as any).tos_accepted ?? data.consent_terms ?? false;
    if (!tosAccepted) {
      return {
        success: false,
        error: 'You must accept the Terms of Service and Privacy Policy to register.',
      };
    }
    const emailMarketingOptIn = (data as any).email_marketing_opt_in ?? data.consent_marketing ?? false;

    const paymentSettings = await getSeasonPaymentSettings(
      serviceSupabase as any,
      data.league_id,
      data.season_id
    );
    if (
      isPlayerFeeConfigurationMissing(
        paymentSettings.feeCollectionModel,
        paymentSettings.feeAmountCents,
        paymentSettings.feeBasis
      )
    ) {
      return {
        success: false,
        error:
          'Registration is not open yet. The league still needs to configure the player registration fee for this season.',
      };
    }

    const expectedFeeCents = getPlayerRegistrationFeeAmount(
      paymentSettings.feeBasis,
      paymentSettings.feeAmountCents
    );
    const billingConfig = await getLeagueBillingConfig(data.league_id);
    const platformFeeCents =
      billingConfig.platformFeeMode === 'pass_to_player' &&
      expectedFeeCents > 0 &&
      billingConfig.platformFeeBps > 0
        ? Math.max(Math.round((expectedFeeCents * billingConfig.platformFeeBps) / 10_000), 50)
        : 0;
    const expectedChargeCents = expectedFeeCents + platformFeeCents;
    const normalizedPrimaryPosition = normalizeRegistrationPosition(data.primary_position);
    const normalizedSecondaryPosition = normalizeRegistrationPosition(data.secondary_position);
    const normalizedSkillLevel = normalizeRegistrationSkillLevel(data.skill_level);
    const paymentMode = getRegistrationPaymentMode(
      paymentSettings.feeCollectionModel,
      paymentSettings.feeAmountCents,
      paymentSettings.feeBasis
    );

    let amountPaidCents = 0;
    const shouldVerifyIndividualPayment =
      expectedFeeCents > 0 &&
      (paymentMode === 'required' ||
        (paymentMode === 'optional' &&
          data.payment_status === 'completed' &&
          Boolean(data.payment_intent_id)));

    if (paymentMode === 'required' && data.payment_status !== 'completed') {
      return {
        success: false,
        error: 'Payment is required for this registration. Please complete payment before submitting.',
      };
    }

    if (shouldVerifyIndividualPayment) {
      if (!data.payment_intent_id) {
        return {
          success: false,
          error: 'Missing payment confirmation. Please complete the payment step.',
        };
      }

      try {
        const stripe = getStripeClient();
        const paymentIntent = await stripe.paymentIntents.retrieve(data.payment_intent_id);

        if (paymentIntent.status !== 'succeeded') {
          return {
            success: false,
            error: `Payment has not been completed (status: ${paymentIntent.status}). Please complete payment before submitting.`,
          };
        }

        if (paymentIntent.amount_received !== expectedChargeCents) {
          console.error('[Registration] Payment amount mismatch', {
            expected: expectedChargeCents,
            received: paymentIntent.amount_received,
            payment_intent_id: data.payment_intent_id,
          });
          return {
            success: false,
            error: 'Payment amount does not match the registration fee. Please contact support.',
          };
        }
      } catch (stripeError) {
        console.error('Stripe PaymentIntent verification failed:', stripeError);
        return {
          success: false,
          error: 'Unable to verify payment. Please try again or contact support.',
        };
      }

      data.payment_status = 'completed';
      data.amount_cents = expectedChargeCents;
      amountPaidCents = expectedFeeCents;
    } else {
      data.payment_status = 'not_required';
      data.amount_cents = 0;
      data.payment_intent_id = undefined;
    }

    // 1. First, save the waiver if not already saved
    let waiverId = null;
    if (data.waiver_agreed) {
      const { data: existingWaiver } = await serviceSupabase
        .from('player_waivers')
        .select('id')
        .eq('player_id', user.id)
        .eq('league_id', data.league_id)
        .eq('season_id', data.season_id)
        .maybeSingle();

      if (existingWaiver) {
        const normalizedSignature = normalizeWaiverSignature({
          signatureType: data.signature_type,
          signatureData: data.signature_data,
          signedName: data.signed_name,
          fallbackName: data.full_name,
        });

        await serviceSupabase
          .from('player_waivers')
          .update({
            waiver_accepted: true,
            waiver_accepted_at: new Date().toISOString(),
            agreed_at: new Date().toISOString(),
            signature_type: normalizedSignature.signatureType as any,
            signature_data: normalizedSignature.signatureData,
            signed_name: normalizedSignature.signedName,
          })
          .eq('id', existingWaiver.id);

        waiverId = existingWaiver.id;
      } else {
        // Get waiver template hash and player name for checkbox flow
        const { data: template } = await serviceSupabase
          .from('league_waiver_templates')
          .select('version, content_hash')
          .eq('league_id', data.league_id)
          .eq('is_active', true)
          .single();

        // For checkbox flow, use player's full name as signed_name
        const normalizedSignature = normalizeWaiverSignature({
          signatureType: data.signature_type,
          signatureData: data.signature_data,
          signedName: data.signed_name,
          fallbackName: data.full_name,
        });

        const { data: newWaiver, error: waiverError } = await serviceSupabase
          .from('player_waivers')
          .insert({
            player_id: user.id,
            league_id: data.league_id,
            season_id: data.season_id,
            signature_data: normalizedSignature.signatureData,
            signature_type: normalizedSignature.signatureType as any,
            signed_name: normalizedSignature.signedName,
            waiver_version: template?.version || 'v1',
            waiver_content_hash: template?.content_hash || '',
            waiver_accepted: true,
            waiver_accepted_at: new Date().toISOString(),
            agreed_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (waiverError) {
          console.error('Waiver save error:', waiverError);
          return { success: false, error: 'Failed to save waiver.' };
        }

        waiverId = newWaiver.id;
      }
    }

    const { data: existingProfile } = await serviceSupabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    const registrationPhotoUrl = data.photo_url || existingProfile?.avatar_url || null;

    // 2. Update profile with emergency contact info
    const { error: profileError } = await serviceSupabase
      .from('profiles')
      .update({
        full_name: data.full_name,
        phone: data.phone || null,
        emergency_contact_name: data.emergency_contact_name,
        emergency_contact_phone: data.emergency_contact_phone,
        emergency_contact_relationship: data.emergency_contact_relationship,
        medical_notes: data.medical_notes || null,
        avatar_url: existingProfile?.avatar_url || registrationPhotoUrl,
        photo_url: registrationPhotoUrl,
      })
      .eq('id', user.id);

    if (profileError) {
      console.error('Profile update error:', profileError);
      return { success: false, error: 'Failed to update profile.' };
    }

    // 3. Upsert registration submission
    const { data: registration, error: regError } = await serviceSupabase
      .from('registration_submissions')
      .upsert(
        {
          player_id: user.id,
          league_id: data.league_id,
          season_id: data.season_id,
          team_id: data.team_id || null,
          waiver_id: waiverId,
          registration_type: data.registration_type,
          status: 'pending',
          preferred_position: normalizedPrimaryPosition,
          secondary_position: normalizedSecondaryPosition,
          preferred_jersey_number: data.preferred_jersey_number || null,
          self_assessed_skill: normalizedSkillLevel,
          years_experience: data.years_experience || null,
          previous_leagues: data.previous_leagues || null,
          photo_url: registrationPhotoUrl,
          payment_status: data.payment_status || 'not_required',
          fee_amount_cents: expectedFeeCents,
          stripe_payment_intent_id: data.payment_intent_id || null,
          amount_paid_cents: amountPaidCents,
          currency: paymentSettings.currency,
          submitted_at: new Date().toISOString(),
          draft_data: null, // Clear draft data on submission
          draft_step: null,
        },
        {
          onConflict: 'player_id,league_id,season_id',
        }
      )
      .select('id, status, payment_status')
      .single();

    if (regError) {
      console.error('Registration error:', regError);
      return {
        success: false,
        error:
          regError.code === '22P02'
            ? 'One of the registration fields is using an unsupported value. Please refresh the page and try again.'
            : 'Failed to submit registration.',
      };
    }

    // 4. Store user consents
    try {
      await persistCanonicalRegistrationConsents(
        serviceSupabase,
        user.id,
        emailMarketingOptIn
      );
    } catch (consentError) {
      console.error('Registration consent persistence warning:', consentError);
    }

    // 5. Send notification emails (async, don't block response)
    try {
      // Get league and season info for emails
      const { data: leagueData } = await serviceSupabase
        .from('leagues')
        .select('name')
        .eq('id', data.league_id)
        .single();

      const { data: seasonData } = await serviceSupabase
        .from('seasons')
        .select('name')
        .eq('id', data.season_id)
        .single();

      const { data: playerData } = await serviceSupabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', user.id)
        .single();

      const { data: teamData } = data.team_id
        ? await serviceSupabase
            .from('teams')
            .select('name')
            .eq('id', data.team_id)
            .single()
        : { data: null };

      // Send confirmation to player
      if (playerData?.email) {
        sendRegistrationSubmittedEmail({
          to: playerData.email,
          playerName: data.full_name,
          leagueName: leagueData?.name || 'League',
          seasonName: seasonData?.name || 'Season',
          registrationType: data.registration_type as 'team_registration' | 'free_agent' | 'individual',
          teamName: teamData?.name,
          position: data.primary_position,
          skillLevel: data.skill_level,
          submittedAt: new Date(),
          registrationId: registration.id,
        }).catch(console.error);
      }

      // Notify league admins
      const { data: admins } = await serviceSupabase
        .from('league_memberships')
        .select('user_id, profiles!inner(email, full_name)')
        .eq('league_id', data.league_id)
        .in('role', ['owner', 'admin'])
        .eq('status', 'active');

      // Get pending count
      const { count: pendingCount } = await serviceSupabase
        .from('registration_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', data.league_id)
        .eq('status', 'pending')
        .not('submitted_at', 'is', null);

      if (admins && admins.length > 0) {
        const adminEmails = admins.map((a: any) => ({
          email: a.profiles.email,
          name: a.profiles.full_name || 'Admin',
        }));

        notifyLeagueAdminsOfNewRegistration({
          adminEmails,
          leagueName: leagueData?.name || 'League',
          seasonName: seasonData?.name || 'Season',
          playerName: data.full_name,
          playerEmail: playerData?.email || '',
          registrationType: data.registration_type as 'team_registration' | 'free_agent' | 'individual',
          teamName: teamData?.name,
          position: data.primary_position,
          skillLevel: data.skill_level,
          submittedAt: new Date(),
          pendingCount: pendingCount || 1,
          registrationId: registration.id,
          leagueId: data.league_id,
        }).catch(console.error);
      }
    } catch (emailError) {
      // Log but don't fail the registration
      console.error('Email notification error:', emailError);
    }

    revalidatePath('/dashboard');

    return {
      success: true,
      data: {
        registrationId: registration.id,
        status: registration.status,
        requiresPayment: registration.payment_status === 'pending',
      },
    };
  } catch (error) {
    console.error('Submit registration error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Cancel player's own registration
 */
export async function cancelRegistration(
  registrationId: string
): ActionResult {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from('registration_submissions')
      .update({ status: 'cancelled' })
      .eq('id', registrationId)
      .eq('player_id', user.id)
      .eq('status', 'pending');

    if (error) {
      console.error('Cancel registration error:', error);
      return { success: false, error: 'Failed to cancel registration.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Cancel registration error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Get player's registration status for a season
 */
export async function getMyRegistrationStatus(
  leagueId: string,
  seasonId: string
): ActionResult<{ status: string; registrationId: string } | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const supabase = await createClient();

    const { data: registration, error } = await supabase
      .from('registration_submissions')
      .select('id, status')
      .eq('player_id', user.id)
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .not('submitted_at', 'is', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: true, data: null };
      }
      return { success: false, error: 'Failed to check registration status.' };
    }

    return {
      success: true,
      data: {
        status: registration.status,
        registrationId: registration.id,
      },
    };
  } catch (error) {
    console.error('Get registration status error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

// ============================================================================
// 6. Admin Actions
// ============================================================================

/**
 * Get pending registrations for a league
 */
export async function getPendingRegistrations(
  leagueId: string,
  options: {
    status?: string;
    type?: string;
    seasonId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): ActionResult<{ registrations: PendingRegistration[]; total: number }> {
  try {
    const result = await verifyLeagueAdminAccess(leagueId);
    if ('error' in result) {
      return { success: false, error: result.error as string };
    }

    const supabase = createServiceRoleClient();
    const { status, type, seasonId, search, limit = 20, offset = 0 } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase
      .from('registration_submissions')
      .select(
        `
        *,
        player:profiles!registration_submissions_player_id_fkey (id, full_name, email, phone, avatar_url, photo_url),
        team:teams!registration_submissions_team_id_fkey (id, name),
        waiver:player_waivers!registration_submissions_waiver_id_fkey (id, signed_name, agreed_at)
      `,
        { count: 'exact' }
      )
      .eq('league_id', leagueId)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status as Database['public']['Enums']['registration_status_enum']);
    }
    if (type) {
      query = query.eq('registration_type', type as Database['public']['Enums']['registration_type_enum']);
    }
    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }
    if (search) {
      query = query.or(`player.full_name.ilike.%${search}%,player.email.ilike.%${search}%`);
    }

    const { data: registrations, error, count } = await query;

    if (error) {
      console.error('Get registrations error:', error);
      return { success: false, error: 'Failed to fetch registrations.' };
    }

    const hydratedRegistrations = await attachWaiverFallbackToRegistrations(
      leagueId,
      ((registrations || []) as unknown as PendingRegistration[])
    );

    return {
      success: true,
      data: {
        registrations: hydratedRegistrations,
        total: count || 0,
      },
    };
  } catch (error) {
    console.error('Get registrations error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Get detailed registration info
 */
export async function getRegistrationDetails(
  registrationId: string
): ActionResult<PendingRegistration> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Please sign in.' };
    }

    const serviceSupabase = createServiceRoleClient();

    const { data: accessRegistration, error: accessError } = await serviceSupabase
      .from('registration_submissions')
      .select('id, player_id, league_id')
      .eq('id', registrationId)
      .single();

    if (accessError || !accessRegistration) {
      return { success: false, error: 'Registration not found.' };
    }

    // Verify access (player viewing own, or admin viewing league's)
    if (accessRegistration.player_id !== user.id) {
      const accessResult = await verifyLeagueAdminAccess(accessRegistration.league_id);
      if ('error' in accessResult) {
        return { success: false, error: accessResult.error || 'Access denied' };
      }
    }

    const { data: registration, error } = await serviceSupabase
      .from('registration_submissions')
      .select(
        `
        *,
        player:profiles!registration_submissions_player_id_fkey (id, full_name, email, phone, avatar_url, photo_url, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, medical_notes),
        team:teams!registration_submissions_team_id_fkey (id, name),
        waiver:player_waivers!registration_submissions_waiver_id_fkey (id, signed_name, agreed_at, signature_data)
      `
      )
      .eq('id', registrationId)
      .single();

    if (error) {
      return { success: false, error: 'Registration not found.' };
    }

    const [hydratedRegistration] = await attachWaiverFallbackToRegistrations(
      accessRegistration.league_id,
      [registration as unknown as PendingRegistration]
    );

    return {
      success: true,
      data: hydratedRegistration,
    };
  } catch (error) {
    console.error('Get registration details error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Record an offline/manual payment against a registration.
 * Supports e-transfer, cash, cheque, or other owner-collected payments.
 */
export async function recordOfflineRegistrationPayment(
  registrationId: string,
  payment: {
    amountCents: number;
    paymentMethod: OfflineRegistrationPaymentMethod;
    referenceNumber?: string;
    notes?: string;
  }
): ActionResult<{
  paymentStatus: string;
  amountPaidCents: number;
  amountOutstandingCents: number;
}> {
  try {
    if (payment.amountCents <= 0) {
      return { success: false, error: 'Payment amount must be greater than 0.' };
    }

    const supabase = createServiceRoleClient();

    const { data: registration, error: registrationError } = await supabase
      .from('registration_submissions')
      .select(`
        id,
        league_id,
        season_id,
        player_id,
        team_id,
        assigned_team_id,
        payment_status,
        fee_amount_cents,
        amount_paid_cents,
        currency,
        draft_data
      `)
      .eq('id', registrationId)
      .single();

    if (registrationError || !registration) {
      return { success: false, error: 'Registration not found.' };
    }

    const access = await verifyLeagueAdminAccess(registration.league_id);
    if ('error' in access) {
      return { success: false, error: access.error || 'Access denied' };
    }

    const totalFeeCents = registration.fee_amount_cents || 0;
    if (registration.payment_status === 'not_required' || totalFeeCents <= 0) {
      return {
        success: false,
        error: 'This registration does not require an individual player payment.',
      };
    }

    const currentPaidCents = registration.amount_paid_cents || 0;
    const outstandingCents = Math.max(0, totalFeeCents - currentPaidCents);

    if (outstandingCents <= 0) {
      return { success: false, error: 'This registration is already fully paid.' };
    }

    if (payment.amountCents > outstandingCents) {
      return {
        success: false,
        error: `Payment exceeds the remaining balance of $${(outstandingCents / 100).toFixed(2)}.`,
      };
    }

    const newAmountPaidCents = currentPaidCents + payment.amountCents;
    const newPaymentStatus = buildRegistrationPaymentStatus(
      totalFeeCents,
      newAmountPaidCents,
      registration.payment_status
    );

    const paymentEvent = {
      amount_cents: payment.amountCents,
      method: payment.paymentMethod,
      reference_number: payment.referenceNumber || null,
      notes: payment.notes || null,
      recorded_at: new Date().toISOString(),
      recorded_by: access.userId,
    };

    const existingDraftData =
      registration.draft_data && typeof registration.draft_data === 'object'
        ? (registration.draft_data as Record<string, unknown>)
        : {};
    const existingEvents = Array.isArray(existingDraftData.admin_payment_events)
      ? existingDraftData.admin_payment_events
      : [];

    const { error: updateRegistrationError } = await supabase
      .from('registration_submissions')
      .update({
        amount_paid_cents: newAmountPaidCents,
        payment_status: newPaymentStatus,
        draft_data: {
          ...existingDraftData,
          admin_payment_events: [...existingEvents, paymentEvent],
          last_manual_payment: paymentEvent,
        },
      })
      .eq('id', registrationId);

    if (updateRegistrationError) {
      console.error('Record offline registration payment error:', updateRegistrationError);
      return { success: false, error: 'Failed to update registration payment status.' };
    }

    const { data: seasonFee } = await supabase
      .from('season_fees')
      .select('id, amount_cents, currency, fee_basis')
      .eq('league_id', registration.league_id)
      .eq('season_id', registration.season_id)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (seasonFee) {
      const paymentRecordStatus =
        newAmountPaidCents >= totalFeeCents
          ? 'paid'
          : newAmountPaidCents > 0
            ? 'partially_paid'
            : 'pending';

      const teamId = registration.assigned_team_id || registration.team_id || null;
      const manualNoteParts = [
        `Manual ${payment.paymentMethod.replace('_', ' ')}`,
        payment.referenceNumber ? `ref ${payment.referenceNumber}` : null,
        payment.notes || null,
      ].filter(Boolean);
      const manualNote = manualNoteParts.join(' - ');

      const { data: existingPlayerPayment } = await supabase
        .from('player_payments')
        .select(`
          id,
          amount_paid_cents,
          total_amount_cents,
          total_installments,
          current_installment,
          notes,
          metadata
        `)
        .eq('league_id', registration.league_id)
        .eq('season_id', registration.season_id)
        .eq('player_id', registration.player_id)
        .eq('season_fee_id', seasonFee.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const mergedMetadata = {
        ...(existingPlayerPayment?.metadata &&
        typeof existingPlayerPayment.metadata === 'object'
          ? (existingPlayerPayment.metadata as Record<string, unknown>)
          : {}),
        registration_id: registrationId,
        offline_payment_method: payment.paymentMethod,
        offline_payment_reference: payment.referenceNumber || null,
      };

      if (existingPlayerPayment) {
        await supabase
          .from('player_payments')
          .update({
            amount_paid_cents: newAmountPaidCents,
            status: paymentRecordStatus as any,
            paid_at:
              paymentRecordStatus === 'paid' ? new Date().toISOString() : null,
            current_installment:
              paymentRecordStatus === 'paid'
                ? existingPlayerPayment.total_installments || 1
                : existingPlayerPayment.current_installment || 1,
            team_id: teamId,
            notes: manualNote
              ? `${existingPlayerPayment.notes || ''}\n[Manual] ${manualNote}`.trim()
              : existingPlayerPayment.notes,
            metadata: mergedMetadata as any,
          })
          .eq('id', existingPlayerPayment.id);
      } else {
        await supabase.from('player_payments').insert({
          player_id: registration.player_id,
          season_fee_id: seasonFee.id,
          team_id: teamId,
          league_id: registration.league_id,
          season_id: registration.season_id,
          payment_plan: 'full',
          base_amount_cents: totalFeeCents || seasonFee.amount_cents,
          discount_cents: 0,
          late_fee_cents: 0,
          installment_fee_cents: 0,
          amount_paid_cents: newAmountPaidCents,
          currency: registration.currency || seasonFee.currency || 'CAD',
          status: paymentRecordStatus as any,
          total_installments: 1,
          current_installment: paymentRecordStatus === 'paid' ? 1 : 0,
          paid_at:
            paymentRecordStatus === 'paid' ? new Date().toISOString() : null,
          notes: manualNote || null,
          metadata: mergedMetadata as any,
        });
      }
    }

    const teamId = registration.assigned_team_id || registration.team_id || null;
    if (teamId) {
      await recalculateTeamInvoiceForTeam(supabase as any, {
        leagueId: registration.league_id,
        seasonId: registration.season_id,
        teamId,
        updatedBy: access.userId,
      });
    }

    revalidatePath(`/dashboard/leagues/${registration.league_id}/registrations`);
    revalidatePath(`/dashboard/leagues/${registration.league_id}/registrations/${registrationId}`);
    revalidatePath(`/dashboard/leagues/${registration.league_id}/payments`);
    revalidatePath(`/dashboard/leagues/${registration.league_id}/billing`);
    revalidatePath('/dashboard');

    return {
      success: true,
      data: {
        paymentStatus: newPaymentStatus,
        amountPaidCents: newAmountPaidCents,
        amountOutstandingCents: Math.max(0, totalFeeCents - newAmountPaidCents),
      },
    };
  } catch (error) {
    console.error('Record offline registration payment error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

export async function updateRegistrationContributionTarget(
  registrationId: string,
  targetAmountCents: number
): ActionResult<{
  feeAmountCents: number;
  amountPaidCents: number;
  amountOutstandingCents: number;
}> {
  try {
    if (targetAmountCents < 0) {
      return { success: false, error: 'Contribution target cannot be negative.' };
    }

    const supabase = createServiceRoleClient();

    const { data: registration } = await supabase
      .from('registration_submissions')
      .select('id, league_id, season_id')
      .eq('id', registrationId)
      .single();

    if (!registration) {
      return { success: false, error: 'Registration not found.' };
    }

    const access = await verifyLeagueAdminAccess(registration.league_id);
    if ('error' in access) {
      return { success: false, error: access.error || 'Access denied' };
    }

    const result = await updateFlatTeamContributionTarget(supabase as any, {
      registrationId,
      targetAmountCents,
    });

    await recalculateTeamInvoiceForTeam(supabase as any, {
      leagueId: result.registration.league_id,
      seasonId: result.registration.season_id,
      teamId: result.teamId,
      seasonFee: result.seasonFee,
      updatedBy: access.userId,
    });

    revalidatePath(`/dashboard/leagues/${result.registration.league_id}/registrations`);
    revalidatePath(
      `/dashboard/leagues/${result.registration.league_id}/registrations/${registrationId}`
    );
    revalidatePath(`/dashboard/leagues/${result.registration.league_id}/payments`);
    revalidatePath(`/dashboard/leagues/${result.registration.league_id}/billing`);

    return {
      success: true,
      data: {
        feeAmountCents: result.registration.fee_amount_cents || 0,
        amountPaidCents: result.registration.amount_paid_cents || 0,
        amountOutstandingCents: Math.max(
          0,
          (result.registration.fee_amount_cents || 0) -
            (result.registration.amount_paid_cents || 0)
        ),
      },
    };
  } catch (error) {
    console.error('Update registration contribution target error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to update the player contribution target.',
    };
  }
}

/**
 * Approve a registration
 */
export async function approveRegistration(
  registrationId: string,
  options: {
    teamId?: string;
    jerseyNumber?: number;
    notes?: string;
  } = {}
): ActionResult {
  try {
    // Get registration to find league ID
    const supabase = createServiceRoleClient();

    const { data: registration } = await supabase
      .from('registration_submissions')
      .select('league_id, player_id, season_id, team_id, assigned_team_id, amount_paid_cents')
      .eq('id', registrationId)
      .single();

    if (!registration) {
      return { success: false, error: 'Registration not found.' };
    }

    const result = await verifyLeagueAdminAccess(registration.league_id);
    if ('error' in result) {
      return { success: false, error: result.error || 'Access denied' };
    }

    const { teamId, jerseyNumber, notes } = options;
    const currentAssignedTeamId =
      registration.assigned_team_id || registration.team_id || null;

    if (
      teamId &&
      currentAssignedTeamId &&
      currentAssignedTeamId !== teamId &&
      (registration.amount_paid_cents || 0) > 0
    ) {
      return {
        success: false,
        error:
          'This player already has recorded payments. Resolve the billing assignment manually before moving them to another team.',
      };
    }

    // Update registration status
    const { error } = await supabase
      .from('registration_submissions')
      .update({
        status: 'approved',
        reviewed_by: result.userId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
        assigned_team_id: teamId || null,
        assigned_jersey_number: jerseyNumber || null,
      })
      .eq('id', registrationId);

    if (error) {
      console.error('Approve registration error:', error);
      return { success: false, error: 'Failed to approve registration.' };
    }

    // If team assigned, add player to roster
    if (teamId) {
      const { data: existingRosterRow } = await supabase
        .from('team_rosters')
        .select('id, team_id')
        .eq('player_id', registration.player_id)
        .eq('league_id', registration.league_id)
        .eq('season_id', registration.season_id)
        .eq('status', 'active')
        .is('end_date', null)
        .maybeSingle();

      if (!existingRosterRow) {
        await supabase.from('team_rosters').insert({
          team_id: teamId,
          player_id: registration.player_id,
          league_id: registration.league_id,
          season_id: registration.season_id,
          jersey_number: jerseyNumber || null,
          status: 'active',
        });
      } else if (existingRosterRow.team_id !== teamId || jerseyNumber !== undefined) {
        await supabase
          .from('team_rosters')
          .update({
            team_id: teamId,
            jersey_number: jerseyNumber || null,
          })
          .eq('id', existingRosterRow.id);
      }
    }

    await reconcileSeasonRegistrationFees(registration.league_id, registration.season_id, {
      registrationId,
    });

    const teamsToRefresh = [...new Set([currentAssignedTeamId, teamId].filter(Boolean))] as string[];
    for (const billingTeamId of teamsToRefresh) {
      await recalculateTeamInvoiceForTeam(supabase as any, {
        leagueId: registration.league_id,
        seasonId: registration.season_id,
        teamId: billingTeamId,
        updatedBy: result.userId,
      });
    }

    // Send approval notification email
    try {
      // Get full registration details
      const { data: fullReg } = await supabase
        .from('registration_submissions')
        .select(`
          *,
          player:profiles!player_id (email, full_name),
          team:teams!team_id (name),
          assigned_team:teams!assigned_team_id (name),
          league:leagues!league_id (name, slug),
          season:seasons!season_id (name, start_date)
        `)
        .eq('id', registrationId)
        .single();

      const paymentRequired =
        Boolean(fullReg?.fee_amount_cents) &&
        (fullReg?.amount_paid_cents || 0) < (fullReg?.fee_amount_cents || 0) &&
        fullReg?.payment_status !== 'not_required' &&
        fullReg?.payment_status !== 'completed' &&
        fullReg?.payment_status !== 'refunded';

      const sitesBaseDomain =
        process.env.NEXT_PUBLIC_SITES_BASE_DOMAIN || 'beerleaguehockey.ca';
      const paymentsUrl =
        fullReg?.league?.slug
          ? `https://${fullReg.league.slug}.${sitesBaseDomain}/me/payments`
          : undefined;

      if (fullReg?.player?.email) {
        const assignedTeam = teamId
          ? await supabase
              .from('teams')
              .select('name')
              .eq('id', teamId)
              .single()
          : null;

        sendRegistrationApprovedEmail({
          to: fullReg.player.email,
          playerName: fullReg.player.full_name || 'Player',
          leagueName: fullReg.league?.name || 'League',
          seasonName: fullReg.season?.name || 'Season',
          registrationType: fullReg.registration_type as 'team_registration' | 'free_agent' | 'individual',
          teamName: assignedTeam?.data?.name || fullReg.assigned_team?.name || fullReg.team?.name,
          jerseyNumber: jerseyNumber,
          position: fullReg.preferred_position ?? undefined,
          seasonStartDate: fullReg.season?.start_date
            ? new Date(fullReg.season.start_date)
            : undefined,
          adminNotes: notes,
          paymentRequired,
          amountDueCents: paymentRequired
            ? Math.max(
                0,
                (fullReg.fee_amount_cents || 0) - (fullReg.amount_paid_cents || 0)
              )
            : 0,
          paymentsUrl,
        }).catch(console.error);
      }
    } catch (emailError) {
      console.error('Approval email error:', emailError);
    }

    revalidatePath('/dashboard');
    revalidatePath(`/dashboard/leagues/${registration.league_id}/billing`);

    return { success: true };
  } catch (error) {
    console.error('Approve registration error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Reject a registration
 */
export async function rejectRegistration(
  registrationId: string,
  reason: string
): ActionResult {
  try {
    const supabase = createServiceRoleClient();

    const { data: registration } = await supabase
      .from('registration_submissions')
      .select('league_id')
      .eq('id', registrationId)
      .single();

    if (!registration) {
      return { success: false, error: 'Registration not found.' };
    }

    const result = await verifyLeagueAdminAccess(registration.league_id);
    if ('error' in result) {
      return { success: false, error: result.error || 'Access denied' };
    }

    const { error } = await supabase
      .from('registration_submissions')
      .update({
        status: 'rejected',
        reviewed_by: result.userId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', registrationId);

    if (error) {
      console.error('Reject registration error:', error);
      return { success: false, error: 'Failed to reject registration.' };
    }

    // Send rejection notification email
    try {
      const { data: fullReg } = await supabase
        .from('registration_submissions')
        .select(`
          *,
          player:profiles!player_id (email, full_name),
          league:leagues!league_id (name),
          season:seasons!season_id (name)
        `)
        .eq('id', registrationId)
        .single();

      if (fullReg?.player?.email) {
        sendRegistrationRejectedEmail({
          to: fullReg.player.email,
          playerName: fullReg.player.full_name || 'Player',
          leagueName: fullReg.league?.name || 'League',
          seasonName: fullReg.season?.name || 'Season',
          registrationType: fullReg.registration_type as 'team_registration' | 'free_agent' | 'individual',
          rejectionReason: reason,
          canReapply: true,
        }).catch(console.error);
      }
    } catch (emailError) {
      console.error('Rejection email error:', emailError);
    }

    revalidatePath('/dashboard');

    return { success: true };
  } catch (error) {
    console.error('Reject registration error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Move a registration to the waitlist
 */
export async function waitlistRegistration(
  registrationId: string
): ActionResult {
  try {
    const supabase = createServiceRoleClient();

    const { data: registration } = await supabase
      .from('registration_submissions')
      .select('league_id')
      .eq('id', registrationId)
      .single();

    if (!registration) {
      return { success: false, error: 'Registration not found.' };
    }

    const result = await verifyLeagueAdminAccess(registration.league_id);
    if ('error' in result) {
      return { success: false, error: result.error || 'Access denied' };
    }

    const { error } = await supabase
      .from('registration_submissions')
      .update({
        status: 'waitlisted',
        reviewed_by: result.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', registrationId);

    if (error) {
      console.error('Waitlist registration error:', error);
      return { success: false, error: 'Failed to waitlist registration.' };
    }

    revalidatePath('/dashboard');

    return { success: true };
  } catch (error) {
    console.error('Waitlist registration error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Bulk update registrations
 */
export async function bulkUpdateRegistrations(
  registrationIds: string[],
  action: 'approve' | 'reject' | 'waitlist',
  options: {
    reason?: string;
    teamId?: string;
  } = {}
): ActionResult<{ updated: number }> {
  try {
    if (registrationIds.length === 0) {
      return { success: false, error: 'No registrations selected.' };
    }

    const supabase = createServiceRoleClient();

    // Get first registration to verify league access
    const { data: firstReg } = await supabase
      .from('registration_submissions')
      .select('league_id')
      .eq('id', registrationIds[0])
      .single();

    if (!firstReg) {
      return { success: false, error: 'Registration not found.' };
    }

    const result = await verifyLeagueAdminAccess(firstReg.league_id);
    if ('error' in result) {
      return { success: false, error: result.error || 'Access denied' };
    }

    const statusMap = {
      approve: 'approved',
      reject: 'rejected',
      waitlist: 'waitlisted',
    };

    const updateData: Record<string, any> = {
      status: statusMap[action],
      reviewed_by: result.userId,
      reviewed_at: new Date().toISOString(),
    };

    if (action === 'reject' && options.reason) {
      updateData.rejection_reason = options.reason;
    }

    if (action === 'approve' && options.teamId) {
      updateData.assigned_team_id = options.teamId;
    }

    const { data, error } = await supabase
      .from('registration_submissions')
      .update(updateData)
      .in('id', registrationIds)
      .eq('league_id', firstReg.league_id)
      .select('id');

    if (error) {
      console.error('Bulk update error:', error);
      return { success: false, error: 'Failed to update registrations.' };
    }

    revalidatePath('/dashboard');

    return { success: true, data: { updated: data?.length || 0 } };
  } catch (error) {
    console.error('Bulk update error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}

/**
 * Get registration summary for admin dashboard
 */
export async function getRegistrationSummary(
  leagueId: string
): ActionResult<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  waitlisted: number;
  byType: {
    team_registration: number;
    free_agent: number;
    individual: number;
  };
}> {
  try {
    const result = await verifyLeagueAdminAccess(leagueId);
    if ('error' in result) {
      return { success: false, error: result.error as string };
    }

    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('registration_submissions')
      .select('status, registration_type')
      .eq('league_id', leagueId)
      .not('submitted_at', 'is', null);

    if (error) {
      console.error('Get summary error:', error);
      return { success: false, error: 'Failed to fetch summary.' };
    }

    const summary = (data || []).reduce(
      (acc, row) => {
        acc.total_submissions += 1;

        if (row.status === 'pending') acc.pending_count += 1;
        if (row.status === 'approved') acc.approved_count += 1;
        if (row.status === 'rejected') acc.rejected_count += 1;
        if (row.status === 'waitlisted') acc.waitlisted_count += 1;

        if (row.registration_type === 'team_registration') {
          acc.team_registrations += 1;
        }
        if (row.registration_type === 'free_agent') {
          acc.free_agents += 1;
        }
        if (row.registration_type === 'individual') {
          acc.individual_registrations += 1;
        }

        return acc;
      },
      {
        total_submissions: 0,
        pending_count: 0,
        approved_count: 0,
        rejected_count: 0,
        waitlisted_count: 0,
        team_registrations: 0,
        free_agents: 0,
        individual_registrations: 0,
      }
    );

    return {
      success: true,
      data: {
        total: summary.total_submissions,
        pending: summary.pending_count,
        approved: summary.approved_count,
        rejected: summary.rejected_count,
        waitlisted: summary.waitlisted_count,
        byType: {
          team_registration: summary.team_registrations,
          free_agent: summary.free_agents,
          individual: summary.individual_registrations,
        },
      },
    };
  } catch (error) {
    console.error('Get summary error:', error);
    return { success: false, error: 'An unexpected error occurred.' };
  }
}
