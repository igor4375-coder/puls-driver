import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Load env
const envFile = readFileSync('/home/ubuntu/driver-app/.env', 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
}

const PLATFORM_URL = env.COMPANY_PLATFORM_URL || 'https://3000-ij0y85xpy8g7q9lzvluoh-0279c63a.us1.manus.computer';
const API_KEY = env.COMPANY_PLATFORM_API_KEY || '';

const routes = [
  'driversApi.getConnectedCompanies',
  'driversApi.getMyCompanies',
  'driversApi.getDriverCompanies',
  'driversApi.getConnections',
  'driversApi.listCompanies',
  'driversApi.getDriverProfile',
];

for (const route of routes) {
  try {
    const url = `${PLATFORM_URL}/api/trpc/${route}?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22driverCode%22%3A%22D-18589%22%7D%7D%7D`;
    const result = execSync(`curl -s "${url}" -H "x-api-key: ${API_KEY}"`, { timeout: 5000 }).toString();
    if (result.includes('No procedure') || result.includes('not found')) {
      console.log('NOT FOUND:', route);
    } else {
      console.log('FOUND:', route, result.slice(0, 300));
    }
  } catch(e) {
    console.log('ERROR:', route, e.message.slice(0, 100));
  }
}
