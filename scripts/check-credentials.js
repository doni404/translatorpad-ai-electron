#!/usr/bin/env node

/**
 * Pre-build script to check for Google Cloud credentials
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Google Cloud credentials for build...');

const credentialsPath = path.join(__dirname, '../credentials/google-cloud-key.json');

if (!fs.existsSync(credentialsPath)) {
  console.error('❌ ERROR: Google Cloud credentials not found!');
  console.error('');
  console.error('To build TransPad AI, you need to provide Google Cloud credentials:');
  console.error('');
  console.error('1. Place your Google Cloud service account key file at:');
  console.error('   credentials/google-cloud-key.json');
  console.error('');
  console.error('2. Make sure the file contains valid JSON credentials');
  console.error('');
  console.error('3. Ensure the credentials have access to:');
  console.error('   - Google Cloud Vision API');
  console.error('   - Google Cloud Translation API');
  console.error('');
  console.error('📖 For detailed setup instructions, see:');
  console.error('   credentials/README.md');
  console.error('');
  process.exit(1);
}

try {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  
  // Basic validation of credentials structure
  if (!credentials.type || !credentials.project_id || !credentials.private_key) {
    console.error('❌ ERROR: Invalid credentials file format!');
    console.error('');
    console.error('The credentials file must be a valid Google Cloud service account key.');
    console.error('Please ensure you downloaded the correct JSON file from Google Cloud Console.');
    console.error('');
    process.exit(1);
  }
  
  console.log('✅ Google Cloud credentials found and validated');
  console.log(`   Project ID: ${credentials.project_id}`);
  console.log(`   Service Account: ${credentials.client_email}`);
  console.log('');
  
} catch (error) {
  console.error('❌ ERROR: Invalid credentials file!');
  console.error('');
  console.error('The credentials file exists but is not valid JSON:');
  console.error(error.message);
  console.error('');
  console.error('Please ensure the file contains valid Google Cloud credentials.');
  console.error('');
  process.exit(1);
}

console.log('🚀 Credentials check passed - proceeding with build...'); 