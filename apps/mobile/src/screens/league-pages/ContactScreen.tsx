/* eslint-disable react-hooks/refs -- acceptance requires callbacks to observe the render-current scope before passive effects */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { CONTACT_LIMITS, contactActionUrl, validateContactDraft, type ContactDraft, type ContactErrors } from '../../lib/eventsContactModel';
import { submitContactSubmission } from '../../lib/supabase/contact';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, LeaguePageFrame, PageHeader, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'Contact'>;
const EMPTY_DRAFT: ContactDraft = { name: '', email: '', subject: '', message: '' };

type ActionKind = 'email' | 'phone' | 'website';

function Detail({ label, value, kind, onOpen }: { label: string; value: string | null; kind?: ActionKind; onOpen?: (url: string, kind: ActionKind) => void }) {
  const url = kind ? contactActionUrl(kind, value) : null;
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text>{url ? <Pressable accessibilityRole="link" accessibilityLabel={`Open ${kind}`} onPress={() => { if (kind) onOpen?.(url, kind); }} style={styles.detailAction}><Text style={styles.link}>{value}</Text></Pressable> : <Text style={styles.detailValue}>{value || 'Not provided'}{kind && value ? ' · Link unavailable' : ''}</Text>}</View>;
}

export default function ContactScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const { user } = useAuth();
  const page = useLeagueContent(scope, { view: 'contact' });
  const identity = `${scope.leagueId}:${scope.leagueSlug}:${user?.id ?? 'guest'}`;
  const ownerRef = React.useRef({ identity, generation: 0, mounted: true });
  if (ownerRef.current.identity !== identity) {
    ownerRef.current = { identity, generation: ownerRef.current.generation + 1, mounted: true };
  }
  const generation = ownerRef.current.generation;
  const requestRef = React.useRef(0);
  const inFlightRef = React.useRef<{ generation: number; request: number } | null>(null);
  const [draftState, setDraftState] = React.useState<{ generation: number; draft: ContactDraft }>({ generation, draft: EMPTY_DRAFT });
  const [resultState, setResultState] = React.useState<{ generation: number; status: 'idle' | 'submitting' | 'success' | 'error'; error: string | null }>({ generation, status: 'idle', error: null });
  const [errorState, setErrorState] = React.useState<{ generation: number; errors: ContactErrors }>({ generation, errors: {} });
  const [linkState, setLinkState] = React.useState<{ generation: number; message: string | null }>({ generation, message: null });
  const isCurrent = () => ownerRef.current.mounted && ownerRef.current.identity === identity && ownerRef.current.generation === generation;
  const draft = draftState.generation === generation ? draftState.draft : EMPTY_DRAFT;
  const result = resultState.generation === generation ? resultState : { generation, status: 'idle' as const, error: null };
  const errors = errorState.generation === generation ? errorState.errors : {};
  const linkMessage = linkState.generation === generation ? linkState.message : null;

  React.useEffect(() => {
    if (ownerRef.current.identity !== identity || ownerRef.current.generation !== generation) return;
    ownerRef.current.mounted = true;
    setDraftState({ generation, draft: EMPTY_DRAFT });
    setResultState({ generation, status: 'idle', error: null });
    setErrorState({ generation, errors: {} });
    setLinkState({ generation, message: null });
    return () => {
      if (ownerRef.current.generation === generation) ownerRef.current = { ...ownerRef.current, mounted: false };
    };
  }, [identity, generation]);

  const setField = (field: keyof ContactDraft, value: string) => {
    if (!isCurrent()) return;
    setDraftState(current => ({ generation, draft: { ...(current.generation === generation ? current.draft : EMPTY_DRAFT), [field]: value } }));
    setErrorState(current => ({ generation, errors: { ...(current.generation === generation ? current.errors : {}), [field]: undefined } }));
    if (result.status === 'error') setResultState({ generation, status: 'idle', error: null });
  };
  const submit = async () => {
    if (!isCurrent() || inFlightRef.current?.generation === generation) return;
    const nextErrors = validateContactDraft(draft); setErrorState({ generation, errors: nextErrors });
    if (Object.keys(nextErrors).length) return;
    const operation = { generation, request: ++requestRef.current };
    inFlightRef.current = operation;
    setResultState({ generation, status: 'submitting', error: null });
    const submitted = await submitContactSubmission({ leagueId: scope.leagueId, draft });
    if (inFlightRef.current !== operation || !isCurrent()) return;
    inFlightRef.current = null;
    if (submitted.success) {
      setDraftState({ generation, draft: EMPTY_DRAFT });
      setResultState({ generation, status: 'success', error: null });
    } else {
      setResultState({ generation, status: 'error', error: submitted.error || 'The message was not accepted.' });
    }
  };
  const openAction = async (url: string, kind: ActionKind) => {
    if (!isCurrent()) return;
    setLinkState({ generation, message: null });
    try {
      await Linking.openURL(url);
    } catch {
      if (isCurrent()) setLinkState({ generation, message: `Could not open ${kind}. Check that a compatible app is installed and try again.` });
    }
  };

  const back = <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.back}><Ionicons name="chevron-back" size={20} color={colors.textInteractive} /><Text style={styles.backText}>Back</Text></Pressable>;
  if (!page.data) return <LeaguePageFrame>{back}<PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const contact = page.data.contact;
  const address = [contact.address, contact.city, contact.state, contact.zipCode].filter(Boolean).join(', ') || null;
  return <LeaguePageFrame>
    {back}
    <PageHeader eyebrow="Get in touch" title="Contact" detail={`Public contact information for ${page.data.league.name}`} />
    <View style={commonStyles.section}><Text style={commonStyles.sectionTitle}>League details</Text><View style={commonStyles.card}>
      <Detail label="Email" value={contact.email} kind="email" onOpen={(url, kind) => { void openAction(url, kind); }} /><Detail label="Phone" value={contact.phone} kind="phone" onOpen={(url, kind) => { void openAction(url, kind); }} /><Detail label="Website" value={contact.websiteUrl} kind="website" onOpen={(url, kind) => { void openAction(url, kind); }} /><Detail label="Address" value={address} />
      {linkMessage ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{linkMessage}</Text></View> : null}
    </View></View>
    <View style={commonStyles.section}><Text style={commonStyles.sectionTitle}>Send a message</Text><View style={commonStyles.card}>
      {result.status === 'success' ? <View accessibilityRole="alert" style={styles.success}><Ionicons name="checkmark-circle" size={24} color={colors.accentGreen} /><Text style={styles.successText}>Your message was accepted.</Text><Text style={styles.meta}>This confirms the league received the form submission. It does not confirm email delivery.</Text></View> : null}
      {result.status === 'error' ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>Message not accepted: {result.error}</Text><Text style={styles.meta}>Your draft is still here. You can edit it and try once more.</Text></View> : null}
      {(['name', 'email', 'subject', 'message'] as const).map(field => <View key={field} style={styles.field}><Text style={styles.label}>{field === 'name' ? 'Your name' : field === 'email' ? 'Email address' : field[0]!.toUpperCase() + field.slice(1)}</Text><TextInput testID={`contact-${field}`} accessibilityLabel={field} value={draft[field]} onChangeText={value => setField(field, value)} editable={result.status !== 'submitting'} maxLength={CONTACT_LIMITS[field]} multiline={field === 'message'} numberOfLines={field === 'message' ? 5 : 1} keyboardType={field === 'email' ? 'email-address' : 'default'} autoCapitalize={field === 'email' ? 'none' : 'sentences'} style={[styles.input, field === 'message' && styles.message, errors[field] && styles.inputError]} />{errors[field] ? <Text accessibilityRole="alert" style={styles.fieldError}>{errors[field]}</Text> : null}</View>)}
      <Pressable testID="contact-submit" accessibilityRole="button" accessibilityState={{ disabled: result.status === 'submitting' }} disabled={result.status === 'submitting'} onPress={() => { void submit(); }} style={[commonStyles.primaryButton, result.status === 'submitting' && styles.disabled]}><Text style={commonStyles.primaryButtonText}>{result.status === 'submitting' ? 'Sending…' : 'Send Message'}</Text></Pressable>
    </View></View>
  </LeaguePageFrame>;
}

const styles = StyleSheet.create({
  back: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }, backText: { color: colors.textInteractive, fontWeight: '900' },
  detailRow: { minHeight: 58, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.glassStroke }, detailLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }, detailValue: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 4 }, detailAction: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.textInteractive, fontSize: 14, fontWeight: '800' },
  field: { marginBottom: 14 }, label: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', marginBottom: 6 }, input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive, color: colors.textPrimary, paddingHorizontal: 12, paddingVertical: 10 }, message: { minHeight: 120, textAlignVertical: 'top' }, inputError: { borderColor: colors.accentRed }, fieldError: { color: colors.accentRed, fontSize: 12, marginTop: 5 }, disabled: { opacity: 0.55 }, success: { marginBottom: 16, padding: 13, borderRadius: 12, backgroundColor: 'rgba(34, 197, 94, 0.14)' }, successText: { color: colors.textPrimary, fontWeight: '900', marginTop: 6 }, error: { marginBottom: 16, padding: 13, borderRadius: 12, backgroundColor: 'rgba(239, 68, 68, 0.14)' }, errorText: { color: colors.accentRed, fontWeight: '900' }, meta: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
