# TransPad AI: Advanced Screenshot Translator

TransPad AI is a powerful desktop application for seamless and intelligent screenshot translation on macOS. Built with Electron, it leverages Google's Cloud Vision and Translation APIs to provide a best-in-class experience for developers, designers, and anyone working with multilingual content.

This tool moves beyond simple text translation, allowing you to capture any part of your screen, automatically recognize the text within the image, and overlay the translation directly onto a new image, preserving the original context.

## App Showcase

Below is a showcase of the TransPad AI interface and workflow.

**Main Application Window**
*The clean and modern interface, showing the translation history.*
![Main application window of TransPad AI](assets/screenshots/main-app.png)

**Interactive Capture Window**
*The "Lup" window allows you to precisely position and resize your capture area.*
![The interactive 'Lup' capture window](assets/screenshots/lup-capture.png)

**Live Translation Result**
*The translated text is displayed directly within the Lup after capture.*
![The translated text result shown in the Lup window](assets/screenshots/lup-result.png)

**Screenshot Gallery**
*Your recent captures are always available in the persistent on-screen gallery.*
![The screenshot gallery feature](assets/screenshots/screenhot-gallery.png)

## Key Features

*   **Intelligent Text Replacement**: Goes beyond simple overlays. It intelligently samples the background behind text, "erases" the original words, and draws the translated text with a dynamically chosen contrasting color for a seamless, "in-lens" translation effect.
*   **Interactive Capture Window**: A movable, resizable window for precise screen captures. No more clumsy click-and-drag!
*   **Screenshot Gallery**: Automatically displays your most recent captures in a persistent, on-screen gallery for easy access.
*   **Dedicated Image Viewer**: Double-click any screenshot in the gallery to open it in a beautiful, frameless viewer window. The viewer is a singleton, meaning it reloads with the new image if already open.
*   **Seamless Loading Indicators**: The app provides clear, multi-step feedback during processing (`Extracting...`, `Translating...`, `Creating Image...`) so you're never left guessing.
*   **AI-Powered Text Recognition**: Utilizes Google Cloud Vision API for highly accurate text extraction from any image.
*   **High-Quality Translation**: Integrates with Google Cloud Translation API for fast and reliable translations.
*   **Optimized UI/UX**: The application window and all internal components are designed to be responsive and provide a polished, comfortable user experience.
*   **Global Shortcuts**: Activate captures, translations, and other core features from anywhere on your system with customizable keyboard shortcuts.
*   **Rich Translation History**: Keeps a detailed record of your previous translations for easy access, copying, and reference.

## Google Cloud API Setup

To enable text extraction and translation features, you need to set up Google Cloud APIs:

### Step 1: Create a Google Cloud Project

1.  Go to [Google Cloud Console](https://console.cloud.google.com/)
2.  Click "Create Project" or select an existing project
3.  Give your project a name (e.g., "TransPad AI") and click "Create"

### Step 2: Enable Required APIs

1.  In the Google Cloud Console, go to "APIs & Services" > "Library"
2.  Search for and enable these APIs:
    *   **Cloud Vision API** (for text extraction from images)
    *   **Cloud Translation API** (for translating text)

### Step 3: Create Service Account Credentials

1.  Go to "APIs & Services" > "Credentials"
2.  Click "Create Credentials" > "Service Account"
3.  Fill in the service account details (e.g., name: `translatorpad-service`)
4.  Click "Create and Continue". Grant these roles:
    *   `Cloud Vision API Service Agent`
    *   `Cloud Translation API Service Agent`
5.  Click "Continue" then "Done"

### Step 4: Download the JSON Key File

1.  In the "Credentials" page, click on your new service account's email.
2.  Go to the "Keys" tab, click "Add Key" > "Create New Key".
3.  Choose "JSON" format and click "Create". A JSON file will be downloaded.

### Step 5: Setup the Credentials in the App

1.  Create a `credentials` folder in your project root.
2.  Copy the downloaded JSON file into the `credentials` folder and **rename it to `google-cloud-key.json`**.
3.  The app will automatically detect and use this file upon restart.

## Installation

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd translatorpad-ai-electron
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Set up Google Cloud credentials** (see instructions above).

## Usage

*   **Run in Development Mode**: `npm run dev`
*   **Build for Production**: `npm run build:mac`
*   **Run Production App**: `npm start`

## Project Structure

```
translatorpad-ai-electron/
├── src/
│   ├── main/
│   │   ├── main.js              # Main Electron process, includes Lup logic
│   │   ├── preload.js           # Preload script for security
│   │   └── services/
│   │       ├── visionService.js
│   │       ├── translationService.js
│   │       └── screenshotService.js
│   └── renderer/
│       ├── index.html           # Main application window
│       ├── styles/
│       │   └── main.css         # Main application styles
│       └── scripts/
│           └── main.js          # Renderer process logic
├── assets/
│   ├── icons/
│   │   └── transpad_512x512.png     # Application icon
│   └── screenshots/
│       └── main-app.png         # Showcase screenshot
├── credentials/                 # Stores Google Cloud key (gitignored)
├── package.json                 # Project configuration
└── README.md                    # This file
```
