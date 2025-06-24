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
      console.log('🔍 Extracting text using DOCUMENT_TEXT_DETECTION from image:', imagePath);
      
      // Use DOCUMENT_TEXT_DETECTION for better structured text extraction
      const [result] = await this.client.documentTextDetection(imagePath);
      
      if (!result.fullTextAnnotation) {
        console.log('⚠️ No text found in the image');
        return { fullText: 'No text found in the image', textBlocks: [] };
      }
      
      const annotation = result.fullTextAnnotation;
      const fullText = annotation.text || 'No text detected';
      
      console.log('📄 Full text extracted:', fullText.substring(0, 100) + '...');
      console.log('📋 Document structure found:');
      console.log(`  Pages: ${annotation.pages?.length || 0}`);
      
      // Extract structured text blocks from the document hierarchy
      const textBlocks = this.extractStructuredTextBlocks(annotation);
      
      console.log(`✅ Extracted ${textBlocks.length} structured text blocks`);
      
      return {
        fullText: fullText,
        textBlocks: textBlocks,
        documentStructure: {
          pages: annotation.pages?.length || 0,
          blocks: this.countBlocks(annotation),
          paragraphs: this.countParagraphs(annotation),
          words: this.countWords(annotation)
        }
      };
    } catch (error) {
      console.error('❌ Error extracting text:', error);
      
      if (error.message.includes('credentials')) {
        throw new Error('Google Cloud credentials are invalid or expired. Please check your setup.');
      } else if (error.message.includes('API')) {
        throw new Error('Google Vision API error. Make sure the API is enabled in your Google Cloud project.');
      } else {
        throw new Error(`Failed to extract text: ${error.message}`);
      }
    }
  }

  // Extract structured text blocks with better hierarchy and positioning
  extractStructuredTextBlocks(annotation) {
    const textBlocks = [];
    
    if (!annotation.pages || annotation.pages.length === 0) {
      console.log('⚠️ No pages found in document structure');
      return textBlocks;
    }
    
    annotation.pages.forEach((page, pageIndex) => {
      console.log(`📖 Processing page ${pageIndex + 1}:`);
      
      if (!page.blocks) {
        console.log('  No blocks found on this page');
        return;
      }
      
      page.blocks.forEach((block, blockIndex) => {
        console.log(`  📦 Block ${blockIndex + 1}:`);
        
        if (!block.paragraphs) {
          console.log('    No paragraphs found in this block');
          return;
        }
        
        block.paragraphs.forEach((paragraph, paragraphIndex) => {
          console.log(`    📝 Paragraph ${paragraphIndex + 1}:`);
          
          if (!paragraph.words) {
            console.log('      No words found in this paragraph');
            return;
          }
          
          // Process each word individually for precise positioning
          paragraph.words.forEach((word, wordIndex) => {
            if (!word.symbols || word.symbols.length === 0) {
              return;
            }
            
            // Combine symbols to form the word text
            const wordText = word.symbols.map(symbol => symbol.text || '').join('');
            
            if (!wordText.trim()) {
              return;
            }
            
            // Get bounding box from word's boundingBox
            const boundingBox = word.boundingBox;
            if (!boundingBox || !boundingBox.vertices || boundingBox.vertices.length < 4) {
              console.log(`      ⚠️ Word "${wordText}" has invalid bounding box`);
              return;
            }
            
            // Create text block with enhanced metadata
            const textBlock = {
              text: wordText,
              boundingPoly: boundingBox,
              vertices: boundingBox.vertices,
              confidence: word.confidence || 0,
              hierarchy: {
                pageIndex,
                blockIndex,
                paragraphIndex,
                wordIndex
              },
              // Additional metadata for better processing
              blockType: block.blockType || 'TEXT',
              detectedLanguages: word.property?.detectedLanguages || [],
              textDirection: paragraph.property?.detectedOrientation || 'HORIZONTAL'
            };
            
            textBlocks.push(textBlock);
            
            console.log(`      📍 Word: "${wordText}" at (${boundingBox.vertices[0].x}, ${boundingBox.vertices[0].y})`);
          });
        });
      });
    });
    
    console.log(`📊 Document processing complete: ${textBlocks.length} word-level text blocks extracted`);
    return textBlocks;
  }

  // Helper function to count blocks in the document
  countBlocks(annotation) {
    if (!annotation.pages) return 0;
    return annotation.pages.reduce((total, page) => total + (page.blocks?.length || 0), 0);
  }

  // Helper function to count paragraphs in the document
  countParagraphs(annotation) {
    if (!annotation.pages) return 0;
    return annotation.pages.reduce((total, page) => {
      if (!page.blocks) return total;
      return total + page.blocks.reduce((blockTotal, block) => 
        blockTotal + (block.paragraphs?.length || 0), 0);
    }, 0);
  }

  // Helper function to count words in the document
  countWords(annotation) {
    if (!annotation.pages) return 0;
    return annotation.pages.reduce((total, page) => {
      if (!page.blocks) return total;
      return total + page.blocks.reduce((blockTotal, block) => {
        if (!block.paragraphs) return blockTotal;
        return blockTotal + block.paragraphs.reduce((paragraphTotal, paragraph) =>
          paragraphTotal + (paragraph.words?.length || 0), 0);
      }, 0);
    }, 0);
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