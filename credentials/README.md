# Google Cloud Credentials Setup for TransPad AI

To use TransPad AI's text extraction and translation features, you need to set up Google Cloud API credentials.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your Project ID

## Step 2: Enable Required APIs

1. In the Google Cloud Console, go to **APIs & Services > Library**
2. Search for and enable these APIs:
   - **Cloud Vision API** (for text extraction)
   - **Cloud Translation API** (for translation)

## Step 3: Create Service Account Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > Service Account**
3. Enter a name like "TransPad AI Service Account"
4. Click **Create and Continue**
5. For roles, add:
   - Cloud Vision API Service Agent
   - Cloud Translation API Service Agent
6. Click **Continue**, then **Done**

## Step 4: Generate and Download Key File

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key > Create New Key**
4. Choose **JSON** format
5. Click **Create** - this downloads the key file

## Step 5: Install the Key File

1. Rename the downloaded file to `google-cloud-key.json`
2. Place it in the `credentials/` folder of this project:
   ```
   translatorpad-ai-electron/
   └── credentials/
       └── google-cloud-key.json  ← Place your file here
   ```

## Step 6: Rebuild the App

After placing the credentials file:

```bash
npm run build:mac
```

Then test the app - the capture and translation features should now work!

## Alternative: Environment Variable

Instead of placing the file in `credentials/`, you can set an environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/google-cloud-key.json"
```

## Security Note

- Never commit the `google-cloud-key.json` file to version control
- The credentials file is already in `.gitignore`
- Keep your credentials file secure and private

## Troubleshooting

If you get API errors:
1. Verify both Vision and Translation APIs are enabled
2. Check that your service account has the correct roles
3. Ensure the JSON file is valid and in the correct location
4. Check the console logs for specific error messages