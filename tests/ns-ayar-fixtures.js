/* Ayar (ns-ayar) — expected detection results for the screenshots in tests/fixtures.
 * To add a case: put the screenshot in tests/fixtures and add one entry here.
 *   sides:   sender of each detected message, top to bottom ('me' | 'them')
 *   status:  'confident' | 'review' | 'low' | 'none'
 *   groups:  number of reply groups (reply + the message under it)
 *   avatars / names: minimum number of avatar / name regions found for blurring (optional) */
window.nsAyarFixtures = [
  { file: 'instagram-full-light.jpg', status: 'review', sides: ['me', 'them', 'them', 'me'], groups: 1, avatars: 2, names: 1 },
  { file: 'instagram-full-dark.png', status: 'review', sides: ['me', 'them', 'them', 'me'], groups: 1, avatars: 2, names: 1 },
  { file: 'instagram-reply-story.jpg', status: 'confident', sides: ['them', 'them'], groups: 1, avatars: 1 },
  { file: 'instagram-single-bubble.jpg', status: 'confident', sides: ['them'], groups: 0, avatars: 1 }
];
