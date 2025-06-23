const vision = require('@google-cloud/vision');
const path = require('path');
const fs = require('fs');

class VisionService {
  constructor() {
    this.client = null;
    this.initializeClient();
  }

  initializeClient() {
    try {
      // Check for credentials file first
      const credentialsPath = path.join(__dirname, '../../../credentials/google-cloud-key.json');
      
      if (fs.existsSync(credentialsPath)) {
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: credentialsPath
        });
        console.log('Vision API initialized with credentials file');
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.client = new vision.ImageAnnotatorClient();
        console.log('Vision API initialized with environment variable');
      } else {
        console.warn('Google Cloud credentials not found. Text extraction will not work.');
        console.warn('Please set up Google Cloud credentials following the README instructions.');
        this.client = null;
      }
    } catch (error) {
      console.error('Error initializing Vision API:', error.message);
      this.client = null;
    }
  }

  async extractText(imagePath) {
    if (!this.client) {
      throw new Error('Google Cloud Vision API not configured. Please set up credentials following the README instructions.');
    }

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    try {
      console.log('Extracting text from image:', imagePath);
      
      const [result] = await this.client.textDetection(imagePath);
      const detections = result.textAnnotations;
      
      if (!detections || detections.length === 0) {
        return { fullText: 'No text found in the image', textBlocks: [] };
      }
      
      // The first detection contains all the text
      const fullText = detections[0].description || 'No text detected';
      
      // Extract individual text blocks with their positions (skip the first one as it's the full text)
      const textBlocks = detections.slice(1).map(detection => ({
        text: detection.description,
        boundingPoly: detection.boundingPoly,
        vertices: detection.boundingPoly.vertices
      }));
      
      console.log('Extracted text:', fullText.substring(0, 100) + '...');
      console.log('Found text blocks:', textBlocks.length);
      
      return {
        fullText: fullText,
        textBlocks: textBlocks
      };
    } catch (error) {
      console.error('Error extracting text:', error);
      
      if (error.message.includes('credentials')) {
        throw new Error('Google Cloud credentials are invalid or expired. Please check your setup.');
      } else if (error.message.includes('API')) {
        throw new Error('Google Vision API error. Make sure the API is enabled in your Google Cloud project.');
      } else {
        throw new Error(`Failed to extract text: ${error.message}`);
      }
    }
  }

  async detectLanguage(text) {
    if (!this.client) {
      throw new Error('Google Vision API not configured.');
    }

    try {
      // Use the translation service to detect language
      const { TranslationService } = require('./translationService');
      const translationService = new TranslationService();
      return await translationService.detectLanguage(text);
    } catch (error) {
      console.error('Error detecting language:', error);
      return 'en'; // Default to English
    }
  }

  isConfigured() {
    return this.client !== null;
  }
}

module.exports = { VisionService }; 