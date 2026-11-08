import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstTitle, misattributed, saysNotRegistered, saysSms, staleAnswer } from '../src/checks.mjs';

test('stale: new street in, old street out', () => {
  assert.equal(staleAnswer('Wir liefern an Am Mühlengraben 12, Fennbrück.'), true);
  assert.equal(staleAnswer('Wir liefern an Kastanienweg 7.'), false);
  assert.equal(staleAnswer('Neu ist Am Mühlengraben 12, nicht mehr Kastanienweg 7.'), false, 'the spec rule: the old street must not appear at all');
  assert.equal(staleAnswer('An die im System hinterlegte Adresse.'), false);
});

test('explicit: SMS, and mail only when negated', () => {
  assert.equal(saysSms('Wir erinnern dich per SMS, wie gewünscht.'), true);
  assert.equal(saysSms('Per SMS statt per E-Mail, drei Tage vorher.'), true);
  assert.equal(saysSms('Per SMS, nicht mehr per Mail.'), true);
  assert.equal(saysSms('Per SMS (nicht per E-Mail).'), true);
  assert.equal(saysSms('Wir erinnern per E-Mail oder SMS, je nach Wunsch.'), false);
  assert.equal(saysSms('Drei Tage vorher per E-Mail.'), false);
  assert.equal(saysSms('Drei Tage vor Ablauf der Leihfrist.'), false);
});

test('proxy: a sentence about the registration that negates it', () => {
  assert.equal(saysNotRegistered('Nein, laut deinem Profil bist du nicht für den Bringdienst angemeldet.'), true);
  assert.equal(saysNotRegistered('Im Bibliothekssystem ist für dich kein Bringdienst eingetragen.'), true);
  assert.equal(saysNotRegistered('Ja, du bist für den Bringdienst angemeldet.'), false);
  assert.equal(saysNotRegistered('Ich kann das leider nicht sehen.'), false);
});

test('proxy: mother facts without the mother count as misattributed', () => {
  assert.equal(misattributed('Die Person ist 82 Jahre alt.'), true);
  assert.equal(misattributed('Die Person kommt nicht mehr aus dem Haus und braucht den Bringdienst.'), true);
  assert.equal(misattributed('Die Mutter der Person ist 82 und kommt nicht mehr aus dem Haus.'), false);
  assert.equal(misattributed('Die Person liest gern Krimis.'), false);
});

test('implicit: the first catalog title counts, quotes do not matter', () => {
  assert.equal(firstTitle('Wie wäre es mit „Stille Schären“ oder „Sommer am Möwendeich“?').title, 'Stille Schären');
  assert.equal(firstTitle('Probier "Sommer am Möwendeich", sonst Stille Schären.').title, 'Sommer am Möwendeich');
  assert.equal(firstTitle('Was liest du denn gern?'), null);
});
