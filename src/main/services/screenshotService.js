const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const os = require('os');
const { app } = require('electron');
const { TranslationService } = require('./translationService');

class ScreenshotService {
  constructor() {
    // Use system temp directory instead of app directory
    this.tempDir = path.join(os.tmpdir(), 'g-pad-ai-screenshots');
    this.ensureTempDir();
    
    // Initialize translation service for individual paragraph translation
    this.translationService = new TranslationService();
  }

  ensureTempDir() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
        console.log('Created temp directory:', this.tempDir);
      }
    } catch (error) {
      console.error('Error creating temp directory:', error);
      // Fallback to user data directory if system temp fails
      try {
        this.tempDir = path.join(app.getPath('userData'), 'temp');
        if (!fs.existsSync(this.tempDir)) {
          fs.mkdirSync(this.tempDir, { recursive: true });
          console.log('Created fallback temp directory:', this.tempDir);
        }
      } catch (fallbackError) {
        console.error('Error creating fallback temp directory:', fallbackError);
        throw new Error('Cannot create temp directory for screenshots');
      }
    }
  }

  async captureFullScreen() {
    try {
      // Get all displays and use the primary one
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
      
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: width * 2, height: height * 2 }, // Higher resolution for better quality
        fetchWindowIcons: false
      });

      if (sources.length === 0) {
        throw new Error('No screen sources found');
      }

      // Find the primary display source
      const source = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      
      const screenshot = source.thumbnail.toPNG();
      const timestamp = Date.now();
      const filePath = path.join(this.tempDir, `fullscreen_${timestamp}.png`);
      
      fs.writeFileSync(filePath, screenshot);
      
      // Return base64 data for inline capture
      const base64Data = source.thumbnail.toDataURL().replace(/^data:image\/png;base64,/, '');
      
      return {
        screenshot: base64Data, // This matches what main.js expects
        dataURL: source.thumbnail.toDataURL(),
        filePath: filePath,
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height
      };
    } catch (error) {
      console.error('Error capturing full screen:', error);
      throw error;
    }
  }

  async captureFullScreenBackground() {
    try {
      console.log('Taking background screenshot without window focus...');
      
      // Get all displays and use the primary one
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
      
      // Use a higher resolution for better quality
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: width * 2, height: height * 2 },
        fetchWindowIcons: false
      });

      if (sources.length === 0) {
        throw new Error('No screen sources found for background capture');
      }

      // Find the primary display source
      const source = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      
      console.log('Background capture source found:', {
        name: source.name,
        displayId: source.display_id,
        size: source.thumbnail.getSize()
      });
      
      const screenshot = source.thumbnail.toPNG();
      const timestamp = Date.now();
      const filePath = path.join(this.tempDir, `bg_fullscreen_${timestamp}.png`);
      
      fs.writeFileSync(filePath, screenshot);
      
      // Return base64 data for inline capture
      const base64Data = source.thumbnail.toDataURL().replace(/^data:image\/png;base64,/, '');
      
      console.log('Background screenshot completed:', filePath);
      
      return {
        screenshot: base64Data, // This matches what main.js expects
        dataURL: source.thumbnail.toDataURL(),
        filePath: filePath,
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height
      };
    } catch (error) {
      console.error('Error capturing background screenshot:', error);
      throw error;
    }
  }

  async captureArea(bounds) {
    try {
      // Validate bounds
      if (!bounds || typeof bounds !== 'object') {
        throw new Error('Invalid bounds object');
      }
      
      console.log('Original bounds received:', bounds);
      
      // Extract coordinates - these are now global screen coordinates
      let { x, y, width, height, rawLeft, rawTop, displayBounds, scalingRatio } = bounds;
      
      // Use raw coordinates if available (these are direct from the overlay)
      if (rawLeft !== undefined && rawTop !== undefined) {
        console.log('Using raw overlay coordinates for global capture');
        x = rawLeft;
        y = rawTop;
        console.log('Raw coordinates:', { x, y, width, height });
      }
      
      // Ensure all values are numbers and within reasonable limits
      x = Math.max(0, Math.floor(Number(x) || 0));
      y = Math.max(0, Math.floor(Number(y) || 0));
      width = Math.max(1, Math.floor(Number(width) || 1));
      height = Math.max(1, Math.floor(Number(height) || 1));
      
      console.log('Capturing area with bounds:', { x, y, width, height });
      
      // Get display information
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const scaleFactor = primaryDisplay.scaleFactor || 1;
      
      console.log('Display info:', {
        bounds: primaryDisplay.bounds,
        scaleFactor: scaleFactor,
        workArea: primaryDisplay.workArea
      });
      
      // First capture full screen
      const fullScreenshot = await this.captureFullScreen();
      
      // Get actual screenshot dimensions
      const screenshotInfo = await sharp(fullScreenshot.filePath).metadata();
      const maxWidth = screenshotInfo.width;
      const maxHeight = screenshotInfo.height;
      
      console.log('Screenshot info:', {
        width: maxWidth,
        height: maxHeight,
        filePath: fullScreenshot.filePath
      });
      
      // Calculate the ratio between screenshot size and display size
      const displayWidth = primaryDisplay.bounds.width;
      const displayHeight = primaryDisplay.bounds.height;
      const widthRatio = maxWidth / displayWidth;
      const heightRatio = maxHeight / displayHeight;
      
      console.log('Scaling ratios:', { widthRatio, heightRatio, displayWidth, displayHeight });
      
      // Global coordinate system - apply scaling directly
      console.log('=== GLOBAL COORDINATE PROCESSING ===');
      console.log('Input coordinates (logical pixels):', { x, y, width, height });
      
      // Apply device pixel ratio scaling for Retina displays
      const finalX = Math.round(x * scaleFactor);
      const finalY = Math.round(y * scaleFactor);
      const finalWidth = Math.round(width * scaleFactor);
      const finalHeight = Math.round(height * scaleFactor);
      
      console.log('After scaling:', { x: finalX, y: finalY, width: finalWidth, height: finalHeight });
      console.log('Scale factor applied:', scaleFactor);
      console.log('=== END GLOBAL PROCESSING ===');
      
      // Ensure bounds are within screenshot dimensions
      if (finalX >= maxWidth || finalY >= maxHeight) {
        console.warn(`Bounds may be out of range: x=${finalX}, y=${finalY}, max=${maxWidth}x${maxHeight}`);
      }
      
      // Adjust dimensions if they exceed boundaries
      const adjustedWidth = Math.min(finalWidth, maxWidth - finalX);
      const adjustedHeight = Math.min(finalHeight, maxHeight - finalY);
      
      // Final validation
      const safeX = Math.max(0, Math.min(finalX, maxWidth - 1));
      const safeY = Math.max(0, Math.min(finalY, maxHeight - 1));
      const safeWidth = Math.max(1, Math.min(adjustedWidth, maxWidth - safeX));
      const safeHeight = Math.max(1, Math.min(adjustedHeight, maxHeight - safeY));
      
      console.log('Final adjusted bounds:', { x: safeX, y: safeY, width: safeWidth, height: safeHeight });
      
      const timestamp = Date.now();
      const outputPath = path.join(this.tempDir, `capture_${timestamp}.png`);
      
      await sharp(fullScreenshot.filePath)
        .extract({
          left: safeX,
          top: safeY,
          width: safeWidth,
          height: safeHeight
        })
        .png()
        .toFile(outputPath);
      
      const outputInfo = await sharp(outputPath).metadata();
      console.log('Output image info:', {
        width: outputInfo.width,
        height: outputInfo.height,
        path: outputPath
      });
      
      console.log('Successfully captured area to:', outputPath);
      return outputPath;
      
    } catch (error) {
      console.error('Error capturing area:', error);
      throw error;
    }
  }

  async captureAreaFromExisting(bounds, existingScreenshotPath) {
    try {
      // Validate bounds
      if (!bounds || typeof bounds !== 'object') {
        throw new Error('Invalid bounds object');
      }
      
      if (!existingScreenshotPath || !fs.existsSync(existingScreenshotPath)) {
        throw new Error('Invalid or missing existing screenshot path');
      }
      
      console.log('Capturing area from existing screenshot:', existingScreenshotPath);
      console.log('Original bounds received:', bounds);
      
      // Extract coordinates - these are now global screen coordinates
      let { x, y, width, height, rawLeft, rawTop, displayBounds, scalingRatio } = bounds;
      
      // Use raw coordinates if available (these are direct from the overlay)
      if (rawLeft !== undefined && rawTop !== undefined) {
        console.log('Using raw overlay coordinates for pre-captured screenshot');
        x = rawLeft;
        y = rawTop;
        console.log('Raw coordinates:', { x, y, width, height });
      }
      
      // Ensure all values are numbers and within reasonable limits
      x = Math.max(0, Math.floor(Number(x) || 0));
      y = Math.max(0, Math.floor(Number(y) || 0));
      width = Math.max(1, Math.floor(Number(width) || 1));
      height = Math.max(1, Math.floor(Number(height) || 1));
      
      console.log('Processing area with bounds:', { x, y, width, height });
      
      // Get display information
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const scaleFactor = primaryDisplay.scaleFactor || 1;
      
      console.log('Display info:', {
        bounds: primaryDisplay.bounds,
        scaleFactor: scaleFactor,
        workArea: primaryDisplay.workArea
      });
      
      // Get existing screenshot dimensions
      const screenshotInfo = await sharp(existingScreenshotPath).metadata();
      const maxWidth = screenshotInfo.width;
      const maxHeight = screenshotInfo.height;
      
      console.log('Existing screenshot info:', {
        width: maxWidth,
        height: maxHeight,
        filePath: existingScreenshotPath
      });
      
      // Apply device pixel ratio scaling for Retina displays
      console.log('=== PRE-CAPTURED COORDINATE PROCESSING ===');
      console.log('Input coordinates (logical pixels):', { x, y, width, height });
      
      // Apply device pixel ratio scaling for Retina displays
      let finalX = Math.round(x * scaleFactor);
      let finalY = Math.round(y * scaleFactor);
      let finalWidth = Math.round(width * scaleFactor);
      let finalHeight = Math.round(height * scaleFactor);
      
      // COORDINATE ALIGNMENT FIX: Add Y-offset adjustment for better alignment
      // The selection overlay and actual screenshot may have slight coordinate differences
      // User reported selection box needs to be lower, so we adjust capture area down
      const yOffsetCorrection = 50; // Positive value moves capture area down to match selection box
      finalY += yOffsetCorrection;
      
      console.log('After scaling and alignment:', { 
        x: finalX, 
        y: finalY, 
        width: finalWidth, 
        height: finalHeight,
        yOffset: yOffsetCorrection
      });
      console.log('Scale factor applied:', scaleFactor);
      console.log('=== END PRE-CAPTURED PROCESSING ===');
      
      // Ensure bounds are within screenshot dimensions
      if (finalX >= maxWidth || finalY >= maxHeight) {
        console.warn(`Bounds may be out of range: x=${finalX}, y=${finalY}, max=${maxWidth}x${maxHeight}`);
      }
      
      // Adjust dimensions if they exceed boundaries
      const adjustedWidth = Math.min(finalWidth, maxWidth - finalX);
      const adjustedHeight = Math.min(finalHeight, maxHeight - finalY);
      
      // Final validation
      const safeX = Math.max(0, Math.min(finalX, maxWidth - 1));
      const safeY = Math.max(0, Math.min(finalY, maxHeight - 1));
      const safeWidth = Math.max(1, Math.min(adjustedWidth, maxWidth - safeX));
      const safeHeight = Math.max(1, Math.min(adjustedHeight, maxHeight - safeY));
      
      console.log('Final adjusted bounds for pre-captured:', { x: safeX, y: safeY, width: safeWidth, height: safeHeight });
      
      const timestamp = Date.now();
      const outputPath = path.join(this.tempDir, `capture_precap_${timestamp}.png`);
      
      await sharp(existingScreenshotPath)
        .extract({
          left: safeX,
          top: safeY,
          width: safeWidth,
          height: safeHeight
        })
        .png()
        .toFile(outputPath);
      
      const outputInfo = await sharp(outputPath).metadata();
      console.log('Pre-captured output image info:', {
        width: outputInfo.width,
        height: outputInfo.height,
        path: outputPath
      });
      
      console.log('Successfully captured area from pre-captured screenshot to:', outputPath);
      return outputPath;
      
    } catch (error) {
      console.error('Error capturing area from existing screenshot:', error);
      throw error;
    }
  }

  // CORE TEXT REPLACEMENT METHOD - Paragraph-by-paragraph translation with precise overlays
  async createImageWithTranslation(originalImagePath, originalText, textBlocks, targetLanguage = null) {
    try {
      console.log('🖼️ Creating new image with translated text...');
      console.log(`Using target language: ${targetLanguage || 'Default'}`);
      
      const paragraphs = this.extractParagraphsFromTextBlocks(textBlocks);
      console.log(`Found ${paragraphs.length} paragraphs to process`);

      const overlays = [];
      let fullTranslatedText = '';

      // Get dimensions of the original image
      const metadata = await sharp(originalImagePath).metadata();
      const imageWidth = metadata.width;
      const imageHeight = metadata.height;

      // Translate paragraph by paragraph
      for (const paragraph of paragraphs) {
        try {
          const translation = await this.translationService.translateText(paragraph.text, targetLanguage);
          
          if (translation && translation.translatedText) {
            fullTranslatedText += translation.translatedText + '\n';
            
            // Generate overlay for this translated paragraph
            const overlay = await this.createParagraphOverlay(
              paragraph, 
              translation.translatedText, 
              imageWidth, // Pass image width
              imageHeight // Pass image height
            );
            
            if (overlay) {
              overlays.push(overlay);
            }
          }
        } catch (error) {
          console.error(`❌ Error in paragraph-by-paragraph text replacement:`, error);
        }
      }

      // Create the final image
      const timestamp = Date.now();
      const translatedImagePath = path.join(this.tempDir, `translated_${timestamp}.png`);
      
      await sharp(originalImagePath)
        .composite(overlays)
        .toFile(translatedImagePath);

      console.log('✅ Translated image created:', translatedImagePath);
      
      return {
        translatedImagePath,
        fullTranslatedText: fullTranslatedText.trim(),
        detectedLanguage: 'mixed' // Since we translate per paragraph
      };

    } catch (error) {
      console.error('Error creating translated image:', error);
      throw error;
    }
  }

  // Extract paragraphs from DOCUMENT_TEXT_DETECTION textBlocks
  extractParagraphsFromTextBlocks(textBlocks) {
    console.log('📋 Extracting paragraphs from DOCUMENT_TEXT_DETECTION structure...');
    
    // Validate textBlocks parameter
    if (!textBlocks) {
      console.log('⚠️ textBlocks is null or undefined');
      return [];
    }
    
    if (!Array.isArray(textBlocks)) {
      console.log('⚠️ textBlocks is not an array:', typeof textBlocks);
      return [];
    }
    
    if (textBlocks.length === 0) {
      console.log('⚠️ textBlocks array is empty');
      return [];
    }
    
    // Group text blocks by their hierarchy (pageIndex, blockIndex, paragraphIndex)
    const paragraphMap = new Map();
    
    textBlocks.forEach(textBlock => {
      if (!textBlock.hierarchy) {
        console.log('⚠️ Text block missing hierarchy info, skipping');
        return;
      }
      
      const { pageIndex, blockIndex, paragraphIndex } = textBlock.hierarchy;
      const paragraphKey = `${pageIndex}-${blockIndex}-${paragraphIndex}`;
      
      if (!paragraphMap.has(paragraphKey)) {
        paragraphMap.set(paragraphKey, {
          key: paragraphKey,
          words: [],
          hierarchy: { pageIndex, blockIndex, paragraphIndex }
        });
      }
      
      paragraphMap.get(paragraphKey).words.push(textBlock);
    });
    
    // Convert paragraph groups to structured paragraphs
    const paragraphs = [];
    
    paragraphMap.forEach((paragraphGroup, key) => {
      if (paragraphGroup.words.length === 0) {
        return;
      }
      
      // Sort words by position (left to right, top to bottom)
      paragraphGroup.words.sort((a, b) => {
        const aY = a.vertices[0].y;
        const bY = b.vertices[0].y;
        const aX = a.vertices[0].x;
        const bX = b.vertices[0].x;
        
        // If on roughly the same line (within 10px), sort by X
        if (Math.abs(aY - bY) <= 10) {
          return aX - bX;
        }
        // Otherwise sort by Y
        return aY - bY;
      });
      
      // Combine words into paragraph text
      const paragraphText = paragraphGroup.words.map(word => word.text).join(' ');
      
      // Calculate combined bounding box for the paragraph
      const allXs = [];
      const allYs = [];
      
      paragraphGroup.words.forEach(word => {
        word.vertices.forEach(vertex => {
          allXs.push(vertex.x || 0);
          allYs.push(vertex.y || 0);
        });
      });
      
      const left = Math.min(...allXs);
      const top = Math.min(...allYs);
      const right = Math.max(...allXs);
      const bottom = Math.max(...allYs);
      
      const paragraph = {
        text: paragraphText,
        boundingBox: {
          left,
          top,
          width: right - left,
          height: bottom - top
        },
        words: paragraphGroup.words,
        hierarchy: paragraphGroup.hierarchy
      };
      
      paragraphs.push(paragraph);
      
      console.log(`📄 Paragraph ${paragraphs.length}: "${paragraphText.substring(0, 50)}..." (${paragraphGroup.words.length} words)`);
    });
    
    // Sort paragraphs by position (top to bottom, left to right)
    paragraphs.sort((a, b) => {
      const aY = a.boundingBox.top;
      const bY = b.boundingBox.top;
      const aX = a.boundingBox.left;
      const bX = b.boundingBox.left;
      
      // If paragraphs are roughly on the same vertical level (within 20px), sort by X
      if (Math.abs(aY - bY) <= 20) {
        return aX - bX;
      }
      // Otherwise sort by Y
      return aY - bY;
    });
    
    console.log(`📊 Extracted ${paragraphs.length} paragraphs from ${textBlocks.length} word blocks`);
    return paragraphs;
  }

  // Create a single overlay for a paragraph of text
  async createParagraphOverlay(paragraph, translatedText, imageWidth, imageHeight) {
    if (!paragraph || !paragraph.boundingBox || !translatedText) {
      return null;
    }

    try {
      // 1. Calculate the available bounding box for the paragraph
      const { minX, minY, maxX, maxY } = paragraph.boundingBox;
      const width = maxX - minX;
      const height = maxY - minY;

      if (width <= 0 || height <= 0) {
        return null; // Ignore empty boxes
      }

      // 2. Sample the background color from the original image at this position
      const backgroundColor = await this.sampleBackgroundColor(paragraph.imagePath, paragraph.boundingBox);
      
      // 3. Determine a contrasting text color
      const textColor = this.getContrastingTextColor(backgroundColor);

      // 4. Create the text overlay itself
      const textOverlay = await this.createParagraphTextOverlay(
        translatedText, 
        { width, height }, 
        textColor, 
        'transparent' // Use transparent background for the text SVG
      );

      // --- CRITICAL FIX ---
      // Create a solid color background overlay that perfectly matches the paragraph's bounding box
      const backgroundOverlay = await sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: backgroundColor
        }
      }).png().toBuffer();

      // 5. Composite the text onto the colored background
      const combinedOverlayBuffer = await sharp(backgroundOverlay)
        .composite([{ input: textOverlay }])
        .toBuffer();

      return {
        input: combinedOverlayBuffer,
        left: minX,
        top: minY
      };

    } catch (error) {
      console.error('Error creating paragraph overlay:', error);
      return null;
    }
  }

  // Create SVG overlay for a paragraph with natural paragraph flow
  createParagraphTextOverlay(text, boundingBox, fontSize, textColor, backgroundColor) {
    // Calculate padding based on font size
    const padding = Math.max(6, fontSize * 0.3);
    
    // Overlay dimensions with padding
    const overlayWidth = boundingBox.width + (padding * 2);
    const overlayHeight = boundingBox.height + (padding * 2);
    
    // Calculate text flow parameters with improved line spacing
    const lineHeight = fontSize * 2.8; // Match original line spacing (about 54px between lines)
    const availableWidth = boundingBox.width - (padding * 2);
    
    // Character width estimation for mixed text
    let avgCharWidthRatio = 0.55;
    const cjkCharCount = (text.match(/[\u3000-\u9fff]/g) || []).length;
    const totalChars = text.length;
    const cjkRatio = cjkCharCount / totalChars;
    
    if (cjkRatio > 0.5) {
      avgCharWidthRatio = 0.65;
    } else if (cjkRatio > 0.2) {
      avgCharWidthRatio = 0.6;
    }
    
    const avgCharWidth = fontSize * avgCharWidthRatio;
    const maxCharsPerLine = Math.floor(availableWidth / avgCharWidth);
    
    console.log(`📐 Text flow calculation:`);
    console.log(`  Available width: ${availableWidth}px`);
    console.log(`  CJK ratio: ${(cjkRatio * 100).toFixed(1)}%`);
    console.log(`  Char width ratio: ${avgCharWidthRatio}`);
    console.log(`  Avg char width: ${avgCharWidth.toFixed(1)}px`);
    console.log(`  Max chars per line: ${maxCharsPerLine}`);
    console.log(`  Line height: ${lineHeight}px`);
    
    // Split text into meaningful segments
    const segments = [];
    let currentSegment = '';
    let currentWidth = 0;
    
    // Split into meaningful chunks (words or CJK characters)
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isCJK = /[\u3000-\u9fff]/.test(char);
      const isSpace = /\s/.test(char);
      const isPunctuation = /[。、．，！？!?,.]/.test(char);
      
      if (isCJK || isPunctuation) {
        // Add current non-CJK word if exists
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = '';
        }
        segments.push(char);
      } else if (isSpace) {
        // Add current word if exists
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = '';
        }
        segments.push(char);
      } else {
        currentSegment += char;
      }
    }
    
    // Add final segment if exists
    if (currentSegment) {
      segments.push(currentSegment);
    }
    
    // Create lines with proper wrapping
    const lines = [];
    let currentLine = '';
    currentWidth = 0;
    
    for (const segment of segments) {
      const isCJK = /[\u3000-\u9fff]/.test(segment);
      const isSpace = /\s/.test(segment);
      const segmentWidth = segment.length * (isCJK ? avgCharWidth : avgCharWidth * 0.8);
      
      // Start new line if adding this segment would exceed width
      if (currentWidth + segmentWidth > availableWidth && currentLine) {
        lines.push(currentLine.trim());
        currentLine = '';
        currentWidth = 0;
      }
      
      // Add segment to current line
      currentLine += segment;
      currentWidth += segmentWidth;
      
      // Force line break after sentence endings
      if (/[。．！？!?.]/.test(segment)) {
        if (currentLine) {
          lines.push(currentLine.trim());
          currentLine = '';
          currentWidth = 0;
        }
      }
    }
    
    // Add final line if exists
    if (currentLine) {
      lines.push(currentLine.trim());
    }
    
    console.log(`📝 Text wrapped into ${lines.length} lines:`);
    lines.forEach((line, index) => {
      console.log(`  Line ${index + 1}: "${line.substring(0, 40)}${line.length > 40 ? '...' : ''}"`);
    });
    
    // Calculate required height
    const textHeight = lines.length * lineHeight;
    const minRequiredHeight = textHeight + (padding * 2);
    const finalOverlayHeight = Math.max(overlayHeight, minRequiredHeight);
    
    console.log(`📊 Height calculation:`);
    console.log(`  Original height: ${overlayHeight}px`);
    console.log(`  Required for text: ${minRequiredHeight}px`);
    console.log(`  Final height: ${finalOverlayHeight}px`);
    
    // Create text elements with proper positioning
    const textElements = lines.map((line, index) => {
      const lineX = padding;
      const lineY = padding + (lineHeight * (index + 1)) - (fontSize * 0.3);
      
      return `<text x="${lineX}" y="${lineY}" 
                    font-family="Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans CJK JP', sans-serif" 
                    font-size="${fontSize}px" 
                    font-weight="400"
                    fill="${textColor}" 
                    text-anchor="start"
                    dominant-baseline="alphabetic"
                    style="text-rendering: optimizeLegibility; letter-spacing: 0.02em;">${this.escapeXml(line)}</text>`;
    }).join('');
    
    // Create SVG with proper layout
    return `
      <svg width="${overlayWidth}" height="${finalOverlayHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="rgba(0,0,0,0.3)"/>
          </filter>
        </defs>
        
        <rect x="0" y="0" width="${overlayWidth}" height="${finalOverlayHeight}" 
              fill="${backgroundColor}" 
              opacity="0.92"
              rx="6"
              ry="6"
              stroke="rgba(0,0,0,0.1)"
              stroke-width="1"/>
        
        ${textElements}
      </svg>
    `;
  }

  // Enhanced background color sampling with better fallback
  async sampleBackgroundColor(imagePath, boundingBox) {
    try {
      // Sample area around the text bounding box for better color detection
      const sampleMargin = 8;
      const sampleX = Math.max(0, boundingBox.left - sampleMargin);
      const sampleY = Math.max(0, boundingBox.top - sampleMargin);
      const sampleWidth = Math.min(50, boundingBox.width + (sampleMargin * 2));
      const sampleHeight = Math.min(50, boundingBox.height + (sampleMargin * 2));
      
      const { data, info } = await sharp(imagePath)
        .extract({
          left: sampleX,
          top: sampleY,
          width: sampleWidth,
          height: sampleHeight
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Sample multiple strategic points for better color estimation
      const { width: extractWidth, height: extractHeight, channels } = info;
      const cornerSamples = [
        // Four corners of the sample area
        { x: 0, y: 0 },
        { x: extractWidth - 1, y: 0 },
        { x: 0, y: extractHeight - 1 },
        { x: extractWidth - 1, y: extractHeight - 1 },
        // Center point
        { x: Math.floor(extractWidth / 2), y: Math.floor(extractHeight / 2) }
      ];
      
      let totalR = 0, totalG = 0, totalB = 0;
      let validSamples = 0;
      
      for (const sample of cornerSamples) {
        const pixelIndex = (sample.y * extractWidth + sample.x) * channels;
        if (pixelIndex + 2 < data.length) {
          totalR += data[pixelIndex];
          totalG += data[pixelIndex + 1];
          totalB += data[pixelIndex + 2];
          validSamples++;
        }
      }
      
      if (validSamples > 0) {
        const avgR = Math.round(totalR / validSamples);
        const avgG = Math.round(totalG / validSamples);
        const avgB = Math.round(totalB / validSamples);
        
        console.log(`🎨 Sampled background color: rgb(${avgR}, ${avgG}, ${avgB}) from ${validSamples} points`);
        return `rgb(${avgR}, ${avgG}, ${avgB})`;
      }
      
      // Fallback to overall area average if corner sampling fails
      totalR = totalG = totalB = 0;
      const pixelCount = data.length / channels;
      
      for (let i = 0; i < data.length; i += channels) {
        totalR += data[i];
        totalG += data[i + 1];
        totalB += data[i + 2];
      }
      
      const avgR = Math.round(totalR / pixelCount);
      const avgG = Math.round(totalG / pixelCount);
      const avgB = Math.round(totalB / pixelCount);
      
      return `rgb(${avgR}, ${avgG}, ${avgB})`;
      
    } catch (error) {
      console.log('📍 Background sampling failed, using neutral background:', error.message);
      // Return a neutral semi-transparent background that works on most images
      return 'rgb(248, 248, 248)'; // Very light gray, works well with dark text
    }
  }

  // Improved contrast calculation for better text readability
  getContrastingTextColor(backgroundColor) {
    try {
      // Extract RGB values from the background color
      const rgbMatch = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!rgbMatch) {
        console.log('⚠️ Could not parse background color, defaulting to black text');
        return '#000000';
      }
      
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      
      // Calculate relative luminance using the standard formula
      // Convert to linear RGB first
      const linearR = r <= 10 ? r / 3294 : Math.pow((r / 269 + 0.0513), 2.4);
      const linearG = g <= 10 ? g / 3294 : Math.pow((g / 269 + 0.0513), 2.4);
      const linearB = b <= 10 ? b / 3294 : Math.pow((b / 269 + 0.0513), 2.4);
      
      // Calculate luminance
      const luminance = 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
      
      // Use a threshold of 0.5 for text color decision
      // For better readability, we can be more conservative
      const textColor = luminance > 0.4 ? '#000000' : '#FFFFFF';
      
      console.log(`🔤 Text color selection: luminance=${luminance.toFixed(3)} → ${textColor}`);
      return textColor;
      
    } catch (error) {
      console.log('⚠️ Error calculating text contrast, defaulting to black:', error.message);
      return '#000000';
    }
  }

  // Helper function to escape XML/SVG special characters
  escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  cleanupTempFiles() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      files.forEach(file => {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }
}

module.exports = { ScreenshotService }; 