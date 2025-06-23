# TranslatorPad AI - Electron App

A powerful macOS application that captures screenshots, extracts text using Google Vision API, and translates it using Google Translate API.

## Features

- **Screenshot Capture**: Select any area of your screen with precision
- **AI Text Recognition**: Advanced OCR powered by Google Vision API
- **Multi-Language Translation**: Translate to 100+ languages using Google Translate API
- **Export Options**: Save results as text files or images with translations
- **Translation History**: Keep track of your previous translations
- **Keyboard Shortcuts**: Quick capture with ⌘+Shift+S
- **Modern UI**: Beautiful, intuitive interface designed for macOS

## Prerequisites

Before running this application, you need to:

1. **Node.js**: Install Node.js (version 16 or higher)
2. **pnpm**: Install pnpm (recommended) or use npm
3. **Google Cloud Account**: Set up Google Cloud Platform account
4. **API Keys**: Enable and configure Google Vision and Translate APIs

## Package Manager

This project is optimized for **pnpm** which offers several advantages over npm:

- **Faster installations**: Up to 2x faster than npm
- **Disk space efficient**: Uses hard links to save space
- **Stricter dependency resolution**: Prevents phantom dependencies
- **Better security**: More secure dependency management

### Install pnpm

```bash
# Install pnpm globally
npm install -g pnpm

# Or using Homebrew on macOS
brew install pnpm

# Or using curl
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Google Cloud API Setup

To enable text extraction and translation features, you need to set up Google Cloud APIs:

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Create Project" or select an existing project
3. Give your project a name (e.g., "TranslatorPad AI")
4. Click "Create"

### Step 2: Enable Required APIs

1. In the Google Cloud Console, go to "APIs & Services" > "Library"
2. Search for and enable these APIs:
   - **Cloud Vision API** (for text extraction from images)
   - **Cloud Translation API** (for translating text)

### Step 3: Create Service Account Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in the service account details:
   - Name: `translatorpad-service`
   - Description: `Service account for TranslatorPad AI`
4. Click "Create and Continue"
5. Grant these roles:
   - `Cloud Vision API Service Agent`
   - `Cloud Translation API Service Agent`
6. Click "Continue" then "Done"

### Step 4: Download the JSON Key File

1. In the "Credentials" page, find your service account
2. Click the service account email
3. Go to the "Keys" tab
4. Click "Add Key" > "Create New Key"
5. Choose "JSON" format and click "Create"
6. A JSON file will be downloaded to your computer

### Step 5: Setup the Credentials in the App

1. Create a `credentials` folder in your project root:
   ```bash
   mkdir credentials
   ```

2. Copy the downloaded JSON file to the `credentials` folder and rename it to `google-cloud-key.json`:
   ```bash
   cp ~/Downloads/your-project-name-xxxxxx.json ./credentials/google-cloud-key.json
   ```

3. The app will automatically detect and use this file

### Step 6: Set Environment Variable (Alternative Method)

Alternatively, you can set an environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="./credentials/google-cloud-key.json"
```

Add this line to your `~/.zshrc` or `~/.bash_profile` to make it permanent.

### Step 7: Test the Setup

1. Restart the app: `pnpm run dev`
2. Try capturing a screenshot with text
3. The app should now extract and translate text successfully

### Pricing Information

- **Vision API**: First 1,000 units per month are free, then $1.50 per 1,000 units
- **Translation API**: First 500,000 characters per month are free, then $20 per 1 million characters

For personal use, you'll likely stay within the free tier limits.

### Troubleshooting

**Error: "Could not load the default credentials"**
- Make sure the JSON file is in the correct location: `./credentials/google-cloud-key.json`
- Check that the file is valid JSON and not corrupted

**Error: "Method doesn't allow unregistered callers"**
- Ensure the APIs are enabled in your Google Cloud project
- Verify your service account has the correct permissions

**Error: "API Key not found"**
- Make sure you're using a Service Account JSON file, not an API key
- The JSON file should contain `private_key`, `client_email`, etc.

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd translatorpad-ai-electron
   ```

2. **Install dependencies**
   
   **Using pnpm (recommended):**
   ```bash
   pnpm install
   ```
   
   **Using npm:**
   ```bash
   npm install
   ```

3. **Set up Google Cloud credentials** (see Google Cloud Setup above)

## Usage

### Development Mode
```bash
# With pnpm
pnpm dev

# With npm
npm run dev
```

### Production Mode
```bash
# With pnpm
pnpm start

# With npm
npm start
```

### Build for macOS
```bash
# With pnpm
pnpm build:mac

# With npm
npm run build:mac
```

### Additional Commands

```bash
# Clean build artifacts and dependencies
pnpm clean

# Rebuild native dependencies
pnpm rebuild

# Install and rebuild (useful after Node.js updates)
pnpm install && pnpm rebuild
```

## How to Use

1. **Launch the app** and you'll see the main interface with a sidebar
2. **Click "Capture & Translate"** or use the keyboard shortcut ⌘+Shift+S
3. **Select an area** on your screen by clicking and dragging
4. **Wait for processing** - the app will extract and translate the text
5. **View results** in the modal dialog
6. **Save your results** as text or image files
7. **Access history** through the sidebar navigation

## Project Structure

```
translatorpad-ai-electron/
├── src/
│   ├── main/
│   │   ├── main.js              # Main Electron process
│   │   ├── preload.js           # Preload script for security
│   │   └── services/
│   │       ├── visionService.js    # Google Vision API integration
│   │       ├── translationService.js # Google Translate API integration
│   │       └── screenshotService.js  # Screenshot capture logic
│   └── renderer/
│       ├── index.html           # Main application window
│       ├── capture.html         # Screenshot capture overlay
│       ├── styles/
│       │   ├── main.css         # Main application styles
│       │   └── capture.css      # Capture overlay styles
│       └── scripts/
│           ├── main.js          # Main application logic
│           └── capture.js       # Capture functionality
├── assets/
│   └── icons/
│       └── icon.png            # Application icon
├── temp/                       # Temporary files (auto-created)
├── package.json               # Project configuration
├── pnpm-lock.yaml            # pnpm lockfile
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## Keyboard Shortcuts

- **⌘+Shift+S**: Start screen capture
- **Escape**: Cancel capture or close modals
- **Enter**: Confirm capture selection

## Troubleshooting

### Common Issues

1. **"Google Vision API not configured"**
   - Ensure you've set up Google Cloud credentials properly
   - Check that the credentials file path is correct
   - Verify that Vision API is enabled in your Google Cloud project

2. **Screenshot capture not working**
   - Grant screen recording permissions to the app in macOS System Preferences
   - Restart the application after granting permissions

3. **Translation fails**
   - Check your internet connection
   - Verify that Translation API is enabled
   - Ensure you have sufficient API quota

4. **App won't start**
   - Run `pnpm install` to ensure all dependencies are installed
   - Check Node.js version (requires 16+)
   - Try rebuilding native dependencies: `pnpm rebuild`
   - Look for error messages in the console

5. **Native dependency issues**
   - Some packages like `canvas` and `sharp` require native compilation
   - Run `pnpm rebuild` after Node.js updates
   - Ensure you have the necessary build tools installed

### pnpm Specific Issues

1. **Peer dependency warnings**
   - pnpm is stricter about peer dependencies
   - Most warnings can be safely ignored
   - Check `pnpm-lock.yaml` for actual installed versions

2. **Module not found errors**
   - pnpm's strict node_modules structure prevents phantom dependencies
   - Install missing dependencies explicitly: `pnpm add <package>`

### Permissions

The app requires the following macOS permissions:
- **Screen Recording**: To capture screenshots
- **Accessibility** (if prompted): For enhanced screen capture features

## Performance Benefits with pnpm

- **Installation speed**: ~2x faster than npm
- **Disk usage**: Saves up to 50% disk space through deduplication
- **CI/CD**: Faster builds in continuous integration environments
- **Monorepo support**: Better handling of workspaces and shared dependencies

## API Costs

This app uses Google Cloud APIs which may incur costs:
- **Vision API**: ~$1.50 per 1,000 requests
- **Translation API**: ~$20 per 1 million characters

Monitor your usage in the Google Cloud Console to avoid unexpected charges.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Install dependencies (`pnpm install`)
4. Make your changes
5. Test the changes (`pnpm dev`)
6. Commit your changes (`git commit -m 'Add some amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue on the GitHub repository or contact the development team.

---

**Note**: This application is designed specifically for macOS. Windows and Linux support may be added in future versions.
