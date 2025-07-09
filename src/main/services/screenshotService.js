const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const os = require('os');
const { app } = require('electron');
const { TranslationService } = require('./translationService');

class ScreenshotService {
  constructor(translationService) {
    // Use system temp directory instead of app directory
    this.tempDir = path.join(os.tmpdir(), 'g-pad-ai-screenshots');
    this.ensureTempDir();
    
    // Use the provided translation service instance
    this.translationService = translationService;
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

  async captureFullScreenBackground(activeDisplay) {
    try {
      console.log('Taking background screenshot without window focus...');
      
      const display = activeDisplay || screen.getPrimaryDisplay();
      const { width, height } = display.bounds;
      
      // Use a higher resolution for better quality
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: width * 2, height: height * 2 },
        fetchWindowIcons: false
      });

      if (sources.length === 0) {
        throw new Error('No screen sources found for background capture');
      }

      // Find the source for the active display
      const source = sources.find(s => s.display_id === display.id.toString()) || sources[0];
      
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

  async captureAreaFromExisting(bounds, existingScreenshotPath, activeDisplay) {
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
      
      const display = activeDisplay || screen.getPrimaryDisplay();
      const scaleFactor = display.scaleFactor || 1;
      
      console.log('Display info:', {
        bounds: display.bounds,
        scaleFactor: scaleFactor,
        workArea: display.workArea
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
      
      // The screenshot is of a single display, so coordinates must be made relative to that display
      const relativeX = x - display.bounds.x;
      const relativeY = y - display.bounds.y;

      // Apply device pixel ratio scaling for Retina displays
      console.log('=== PRE-CAPTURED COORDINATE PROCESSING ===');
      console.log('Input coordinates (logical pixels):', { x, y, width, height });
      
      // Apply device pixel ratio scaling for Retina displays
      let finalX = Math.round(relativeX * scaleFactor);
      let finalY = Math.round(relativeY * scaleFactor);
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
      console.log('🖼️ Creating new image with translated text (Advanced Replacement)...');

      let detectedLanguage = 'unknown';
      if (originalText && originalText.trim()) {
        try {
            const detectionResult = await this.translationService.detectLanguage(originalText);
            if (detectionResult) detectedLanguage = detectionResult.language || 'unknown';
        } catch (e) {
            console.warn('Could not detect source language', e.message);
        }
      }

      const paragraphs = this.extractParagraphsFromTextBlocks(textBlocks, originalImagePath);
      const compositeOverlays = [];
      let fullTranslatedText = '';

      const { width: imageWidth, height: imageHeight } = await sharp(originalImagePath).metadata();

      for (const paragraph of paragraphs) {
        try {
          const translatedText = await this.translationService.translateText(paragraph.text, targetLanguage);
          if (!translatedText) continue;

          fullTranslatedText += translatedText + '\n';
          const { minX, minY, maxX, maxY } = paragraph.boundingBox;
          const width = maxX - minX;
          const height = maxY - minY;

          if (width <= 0 || height <= 0) continue;

          // 1. "Heal" the background by covering old text
          const backgroundColor = await this.sampleBackgroundColor(originalImagePath, paragraph.boundingBox);
          compositeOverlays.push({
            input: { create: { width, height, channels: 4, background: backgroundColor } },
            left: minX,
            top: minY,
          });

          // 2. Prepare the new text overlay
          const textColor = this.getContrastingTextColor(backgroundColor);
          const estimatedCharsPerLine = Math.max(1, width / 10);
          const estimatedLines = Math.ceil(translatedText.length / estimatedCharsPerLine);
          let fontSize = Math.floor(height / Math.max(1, estimatedLines) * 0.75);
          fontSize = Math.max(12, Math.min(fontSize, 40));

          const textSvg = await this.createParagraphTextOverlay(translatedText, { width, height }, fontSize, textColor);
          compositeOverlays.push({
            input: Buffer.from(textSvg),
            left: minX,
            top: minY,
          });

        } catch (error) {
          console.error('❌ Error processing paragraph:', error);
        }
      }

      const timestamp = Date.now();
      const translatedImagePath = path.join(this.tempDir, `translated_${timestamp}.png`);
      
      await sharp(originalImagePath).composite(compositeOverlays).toFile(translatedImagePath);

      console.log('✅ Translated image created:', translatedImagePath);
      
      return {
        translatedImagePath,
        fullTranslatedText: fullTranslatedText.trim(),
        detectedLanguage: detectedLanguage
      };

    } catch (error) {
      console.error('Error creating translated image:', error);
      throw error;
    }
  }

  // Extract paragraphs from DOCUMENT_TEXT_DETECTION textBlocks
  extractParagraphsFromTextBlocks(textBlocks, originalImagePath) {
    console.log('📋 Extracting paragraphs from DOCUMENT_TEXT_DETECTION structure...');
    
    if (!textBlocks || !Array.isArray(textBlocks) || textBlocks.length === 0) {
      console.log('⚠️ textBlocks is invalid or empty');
      return [];
    }
    
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
    
    const paragraphs = [];
    
    paragraphMap.forEach((paragraphGroup) => {
      if (paragraphGroup.words.length === 0) return;
      
      paragraphGroup.words.sort((a, b) => {
        const aY = a.vertices[0].y;
        const bY = b.vertices[0].y;
        if (Math.abs(aY - bY) <= 10) return a.vertices[0].x - b.vertices[0].x;
        return aY - bY;
      });
      
      const paragraphText = paragraphGroup.words.map(word => word.text).join(' ');
      
      const allXs = paragraphGroup.words.flatMap(word => word.vertices.map(v => v.x || 0));
      const allYs = paragraphGroup.words.flatMap(word => word.vertices.map(v => v.y || 0));
      
      const paragraph = {
        text: paragraphText,
        boundingBox: {
          minX: Math.min(...allXs),
          minY: Math.min(...allYs),
          maxX: Math.max(...allXs),
          maxY: Math.max(...allYs),
        },
        imagePath: originalImagePath
      };
      
      paragraphs.push(paragraph);
    });
    
    paragraphs.sort((a, b) => {
        const aY = a.boundingBox.minY;
        const bY = b.boundingBox.minY;
        if (Math.abs(aY - bY) <= 20) return a.boundingBox.minX - b.boundingBox.minX;
        return aY - bY;
    });
    
    console.log(`📊 Extracted ${paragraphs.length} paragraphs.`);
    return paragraphs;
  }

  async createParagraphTextOverlay(text, boundingBox, fontSize, textColor) {
    const { width, height } = boundingBox;
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        // Create a temporary SVG to measure the text width accurately
        const tempSvg = `<svg><text font-family="-apple-system, sans-serif" font-size="${fontSize}px">${this.escapeXml(testLine)}</text></svg>`;
        const { info } = await sharp(Buffer.from(tempSvg)).toBuffer({ resolveWithObject: true });

        if (info.width < width) {
            currentLine = testLine;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);

    const lineHeight = fontSize * 1.2;
    const totalTextHeight = lines.length * lineHeight;
    const startY = (height - totalTextHeight) / 2 + (lineHeight / 2);

    const textElements = lines.map((line, index) => {
        const y = startY + (index * lineHeight);
        const escapedLine = this.escapeXml(line);
        return `<text x="5" y="${y}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="${fontSize}px" fill="${textColor}" text-anchor="start" dominant-baseline="middle">${escapedLine}</text>`;
    }).join('');

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${textElements}</svg>`;
  }

  async sampleBackgroundColor(imagePath, boundingBox) {
    try {
      const { minX, minY, maxX, maxY } = boundingBox;
      const extractWidth = Math.max(1, maxX - minX);
      const extractHeight = Math.max(1, maxY - minY);

      const { data } = await sharp(imagePath)
        .extract({ left: minX, top: minY, width: extractWidth, height: extractHeight })
        .blur(5)
        .toBuffer({ resolveWithObject: true });

      const centerX = Math.floor(extractWidth / 2);
      const centerY = Math.floor(extractHeight / 2);
      const pixelIndex = (centerY * extractWidth + (channels || 4)) * centerX;
      
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      
      return `rgb(${r},${g},${b})`;

    } catch (error) {
      console.log('📍 Background sampling failed, using neutral background:', error.message);
      return 'rgb(248, 248, 248)';
    }
  }

  getContrastingTextColor(backgroundColor) {
    try {
      const rgbMatch = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!rgbMatch) return '#000000';
      
      const [r, g, b] = [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      
      return luminance > 0.5 ? '#000000' : '#FFFFFF';
    } catch (error) {
      return '#000000';
    }
  }

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