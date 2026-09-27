import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../20260927110000_hockey_life_times_media.sql', import.meta.url),
  'utf8',
);

test('uses dedicated private and approved-public buckets without altering news-images', () => {
  assert.match(source, /'newspaper-media-private'[\s\S]*false[\s\S]*16777216[\s\S]*'image\/png'[\s\S]*'application\/json'/);
  assert.match(source, /'newspaper-media-public'[\s\S]*true[\s\S]*16777216[\s\S]*ARRAY\['image\/png'\]/);
  assert.doesNotMatch(source, /UPDATE\s+storage\.buckets[\s\S]*news-images/i);
});

test('adds restrictive client denial gates and service-only mutation policies', () => {
  assert.equal((source.match(/AS RESTRICTIVE/g) || []).length, 4);
  assert.match(source, /FOR INSERT TO anon, authenticated[\s\S]*NOT IN \('newspaper-media-private', 'newspaper-media-public'\)/);
  assert.match(source, /FOR UPDATE TO anon, authenticated[\s\S]*NOT IN \('newspaper-media-private', 'newspaper-media-public'\)/);
  assert.match(source, /FOR DELETE TO anon, authenticated[\s\S]*NOT IN \('newspaper-media-private', 'newspaper-media-public'\)/);
  assert.match(source, /FOR ALL TO service_role[\s\S]*bucket_id = 'newspaper-media-private'/);
  assert.match(source, /FOR ALL TO service_role[\s\S]*bucket_id = 'newspaper-media-public'/);
});
