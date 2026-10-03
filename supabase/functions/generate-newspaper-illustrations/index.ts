import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
import {
  IMAGE_MODEL,
  IMAGE_QUALITY,
  IMAGE_SIZE,
  MAX_OUTPUT_IMAGE_BYTES,
  OUTPUT_MIME,
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  assertExpectedSupabaseUrl,
  assertMediaBucketConfiguration,
  assertPng1024,
  fetchPlayerPhoto,
  isGatewayVerifiedServiceRole,
  parseIllustrationRequest,
  readResponseBytes,
} from './policy.ts';
import {
  generateIllustrations,
  makeRepository,
} from './workflow.ts';
import {
  ObservableIllustrationError,
  OVERALL_DEADLINE_MS,
  PROVIDER_TIMEOUT_MS,
  illustrationFailureLog,
  publicIllustrationError,
} from './runtime.ts';

const MAX_REQUEST_BYTES = 4096;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function decodeBase64Image(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_OUTPUT_IMAGE_BYTES * 4 / 3) + 8) {
    throw new Error('INVALID_PROVIDER_RESPONSE');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('INVALID_PROVIDER_RESPONSE');
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error('INVALID_PROVIDER_RESPONSE');
  }
}

async function callOpenAI(apiKey: string, input: { image: Uint8Array; mime: string; prompt: string }, deadlineAt: number) {
  {
    const controller = new AbortController();
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error('GENERATION_DEADLINE_EXCEEDED');
    const timer = setTimeout(() => controller.abort(), Math.min(PROVIDER_TIMEOUT_MS, remaining));
    try {
      const extension = input.mime === 'image/png' ? 'png' : input.mime === 'image/webp' ? 'webp' : 'jpg';
      const form = new FormData();
      form.append('image[]', new Blob([new Uint8Array(input.image).buffer], { type: input.mime }), `profile.${extension}`);
      form.append('model', IMAGE_MODEL);
      form.append('prompt', input.prompt);
      form.append('size', IMAGE_SIZE);
      form.append('quality', IMAGE_QUALITY);
      form.append('n', '1');
      form.append('output_format', 'png');
      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const status = response.status;
        const requestId = response.headers.get('x-request-id');
        await response.body?.cancel();
        throw new ObservableIllustrationError('PROVIDER_REQUEST_FAILED', 'provider_request', status, requestId);
      }
      const bodyBytes = await readResponseBytes(response, Math.ceil(MAX_OUTPUT_IMAGE_BYTES * 4 / 3) + 1024 * 1024);
      let body: any;
      try {
        body = JSON.parse(new TextDecoder().decode(bodyBytes));
      } catch {
        throw new ObservableIllustrationError('INVALID_PROVIDER_RESPONSE', 'provider_validation', response.status, response.headers.get('x-request-id'));
      }
      if (!Array.isArray(body?.data) || body.data.length !== 1) {
        throw new ObservableIllustrationError('INVALID_PROVIDER_RESPONSE', 'provider_validation', response.status, response.headers.get('x-request-id'));
      }
      const image = decodeBase64Image(body.data[0]?.b64_json);
      await assertPng1024(image);
      return { image, requestId: response.headers.get('x-request-id') };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ObservableIllustrationError('PROVIDER_TIMEOUT', 'provider_timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } });
  if (!isGatewayVerifiedServiceRole(request.headers.get('authorization'))) {
    return jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'A gateway-verified service-role token for this project is required.' } });
  }

  try {
    const deadlineAt = Date.now() + OVERALL_DEADLINE_MS;
    const declaredLength = Number(request.headers.get('content-length') || '0');
    if (declaredLength > MAX_REQUEST_BYTES) throw new Error('INVALID_REQUEST');
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) throw new Error('INVALID_REQUEST');
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new Error('INVALID_REQUEST');
    }
    const input = parseIllustrationRequest(body);
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    assertExpectedSupabaseUrl(supabaseUrl);
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!serviceRoleKey || !openAiApiKey) throw new Error('SERVER_CONFIGURATION_MISSING');
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [privateBucket, publicBucket] = await Promise.all([
      supabase.storage.getBucket(PRIVATE_MEDIA_BUCKET),
      supabase.storage.getBucket(PUBLIC_MEDIA_BUCKET),
    ]);
    if (privateBucket.error || publicBucket.error || !privateBucket.data || !publicBucket.data) {
      throw new Error('STORAGE_CONFIGURATION_INVALID');
    }
    assertMediaBucketConfiguration(privateBucket.data, publicBucket.data);
    const result = await generateIllustrations(input, {
      repository: await makeRepository(supabase, serviceRoleKey),
      photos: { load: (url) => fetchPlayerPhoto(url, fetch) },
      provider: { generate: (providerInput) => callOpenAI(openAiApiKey, providerInput, deadlineAt) },
      concurrency: 4,
      deadlineAt,
    });
    return jsonResponse(200, result);
  } catch (error) {
    const safe = publicIllustrationError(error);
    console.error(JSON.stringify(illustrationFailureLog(error, safe.code)));
    return jsonResponse(safe.status, { error: { code: safe.code, message: safe.message } });
  }
});
