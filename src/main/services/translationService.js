const { Translate } = require('@google-cloud/translate').v2;
const path = require('path');
const fs = require('fs');

class TranslationService {
  constructor() {
    this.translate = null;
    this.initializeClient();
  }

  initializeClient() {
    try {
      // Check for credentials file first
      const credentialsPath = path.join(__dirname, '../../../credentials/google-cloud-key.json');
      
      if (fs.existsSync(credentialsPath)) {
        this.translate = new Translate({
          keyFilename: credentialsPath
        });
        console.log('Translation API initialized with credentials file');
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.translate = new Translate();
        console.log('Translation API initialized with environment variable');
      } else {
        console.warn('Google Cloud credentials not found. Translation will not work.');
        console.warn('Please set up Google Cloud credentials following the README instructions.');
        this.translate = null;
      }
    } catch (error) {
      console.error('Error initializing Translation API:', error.message);
      this.translate = null;
    }
  }

  async translateText(text, targetLanguage = 'en') {
    if (!this.translate) {
      throw new Error('Google Cloud Translation API not configured. Please set up credentials following the README instructions.');
    }

    if (!text || text.trim() === '') {
      return 'No text to translate';
    }

    try {
      console.log(`Translating text to ${targetLanguage}:`, text.substring(0, 100) + '...');
      
      const [translation] = await this.translate.translate(text, targetLanguage);
      
      console.log('Translation completed');
      return translation;
    } catch (error) {
      console.error('Error translating text:', error);
      
      if (error.message.includes('credentials')) {
        throw new Error('Google Cloud credentials are invalid or expired. Please check your setup.');
      } else if (error.message.includes('API')) {
        throw new Error('Google Translation API error. Make sure the API is enabled in your Google Cloud project.');
      } else if (error.message.includes('language')) {
        throw new Error(`Unsupported language code: ${targetLanguage}`);
      } else {
        throw new Error(`Failed to translate text: ${error.message}`);
      }
    }
  }

  async detectLanguage(text) {
    if (!this.translate) {
      console.warn('Translation API not configured, cannot detect language');
      return { language: 'unknown', confidence: 0 };
    }

    if (!text || text.trim() === '') {
      return { language: 'unknown', confidence: 0 };
    }

    try {
      console.log('Detecting language for text:', text.substring(0, 50) + '...');
      const [detection] = await this.translate.detect(text);
      
      console.log('Language detection result:', detection);
      
      // Handle both single detection and array of detections
      const detectionResult = Array.isArray(detection) ? detection[0] : detection;
      
      return {
        language: detectionResult.language || 'unknown',
        confidence: detectionResult.confidence || 0
      };
    } catch (error) {
      console.error('Error detecting language:', error);
      return { language: 'unknown', confidence: 0 };
    }
  }

  async getSupportedLanguages() {
    // Return a basic set of languages that work without API
    const fallbackLanguages = [
      { code: 'af', name: 'Afrikaans' },
      { code: 'ar', name: 'Arabic' },
      { code: 'bg', name: 'Bulgarian' },
      { code: 'bn', name: 'Bengali' },
      { code: 'ca', name: 'Catalan' },
      { code: 'cs', name: 'Czech' },
      { code: 'cy', name: 'Welsh' },
      { code: 'da', name: 'Danish' },
      { code: 'de', name: 'German' },
      { code: 'el', name: 'Greek' },
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'et', name: 'Estonian' },
      { code: 'fi', name: 'Finnish' },
      { code: 'fr', name: 'French' },
      { code: 'gu', name: 'Gujarati' },
      { code: 'he', name: 'Hebrew' },
      { code: 'hi', name: 'Hindi' },
      { code: 'hr', name: 'Croatian' },
      { code: 'hu', name: 'Hungarian' },
      { code: 'id', name: 'Indonesian' },
      { code: 'is', name: 'Icelandic' },
      { code: 'it', name: 'Italian' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ka', name: 'Georgian' },
      { code: 'kk', name: 'Kazakh' },
      { code: 'ko', name: 'Korean' },
      { code: 'lt', name: 'Lithuanian' },
      { code: 'lv', name: 'Latvian' },
      { code: 'mk', name: 'Macedonian' },
      { code: 'ms', name: 'Malay' },
      { code: 'mt', name: 'Maltese' },
      { code: 'nl', name: 'Dutch' },
      { code: 'no', name: 'Norwegian' },
      { code: 'pl', name: 'Polish' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'ro', name: 'Romanian' },
      { code: 'ru', name: 'Russian' },
      { code: 'sk', name: 'Slovak' },
      { code: 'sl', name: 'Slovenian' },
      { code: 'sq', name: 'Albanian' },
      { code: 'sv', name: 'Swedish' },
      { code: 'sw', name: 'Swahili' },
      { code: 'ta', name: 'Tamil' },
      { code: 'te', name: 'Telugu' },
      { code: 'th', name: 'Thai' },
      { code: 'tl', name: 'Filipino' },
      { code: 'tr', name: 'Turkish' },
      { code: 'uk', name: 'Ukrainian' },
      { code: 'ur', name: 'Urdu' },
      { code: 'vi', name: 'Vietnamese' },
      { code: 'zh', name: 'Chinese (Simplified)' },
      { code: 'zh-TW', name: 'Chinese (Traditional)' }
    ];

    if (!this.translate) {
      console.log('Using fallback language list (API not configured)');
      return fallbackLanguages;
    }

    try {
      const [languages] = await this.translate.getLanguages();
      return languages.map(lang => ({
        code: lang.code,
        name: lang.name
      }));
    } catch (error) {
      console.error('Error getting supported languages, using fallback:', error);
      return fallbackLanguages;
    }
  }

  isConfigured() {
    return this.translate !== null;
  }
}

module.exports = { TranslationService }; 