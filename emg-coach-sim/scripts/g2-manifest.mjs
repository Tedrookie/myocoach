import { writeFileSync } from 'node:fs';

const supplied = process.argv[2];
if (!supplied) {
  console.error('Usage: npm run g2:manifest -- http://YOUR-LAN-IP:5173');
  process.exit(1);
}

let origin;
try {
  const url = new URL(supplied);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an http(s) origin without a path');
  }
  if (['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Use the computer LAN address, not localhost; the app runs on the phone');
  }
  origin = url.origin;
} catch (error) {
  console.error(`Invalid MyoCoach server URL: ${error.message}`);
  process.exit(1);
}

const manifest = {
  package_id: 'com.myocoach.g2',
  edition: '202601',
  name: 'MyoCoach G2',
  version: '0.1.0',
  min_app_version: '2.2.9',
  min_sdk_version: '0.0.14',
  entrypoint: 'g2.html',
  permissions: [{
    name: 'network',
    desc: 'Connect to your MyoCoach workout on the same Wi-Fi to show sets and rest time.',
    whitelist: [origin],
  }],
  supported_languages: ['en'],
};

writeFileSync('app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote app.json with workout server ${origin}`);
