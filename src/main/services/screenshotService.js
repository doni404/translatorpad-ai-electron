const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class ScreenshotService {
  constructor() {
    this.tempDir = path.join(__dirname, '../../../temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
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

  async captureArea(bounds) {
    try {
      // Validate bounds
      if (!bounds || typeof bounds !== 'object') {
        throw new Error('Invalid bounds object');
      }
      
      let { x, y, width, height, windowX, windowY, windowWidth, windowHeight, rawLeft, rawTop } = bounds;
      
      // Use raw coordinates if available (these are the actual overlay coordinates)
      if (rawLeft !== undefined && rawTop !== undefined) {
        console.log('Using raw overlay coordinates for exact matching');
        x = rawLeft;
        y = rawTop;
        // Width and height from the pre-scaled values but convert back
        width = Math.round(width / 2); // Convert back from scaled
        height = Math.round(height / 2); // Convert back from scaled
        console.log('Raw coordinates:', { x, y, width, height });
      }
      
      // Ensure all values are numbers and within reasonable limits
      x = Math.max(0, Math.floor(Number(x) || 0));
      y = Math.max(0, Math.floor(Number(y) || 0));
      width = Math.max(1, Math.floor(Number(width) || 1));
      height = Math.max(1, Math.floor(Number(height) || 1));
      
      console.log('Original bounds received:', bounds);
      console.log('Capturing area with bounds:', { x, y, width, height });
      
      // Get display information for better coordinate handling
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
      
      // Dynamic coordinate correction based on window positioning
      let correctedX = x;
      let correctedY = y;
      
      // If window positioning data is available, use it for dynamic correction
      if (windowX !== undefined && windowY !== undefined && windowWidth !== undefined && windowHeight !== undefined) {
        console.log('=== DYNAMIC COORDINATE CORRECTION ===');
        console.log('Window data:', { windowX, windowY, windowWidth, windowHeight });
        console.log('Raw selection coordinates:', { x, y, width, height });
        
        // Apply proper device pixel ratio scaling
        // The coordinates from overlay are in logical pixels, need to convert to physical pixels
        correctedX = Math.round(x * scaleFactor);
        correctedY = Math.round(y * scaleFactor);
        width = Math.round(width * scaleFactor);
        height = Math.round(height * scaleFactor);
        
        // Dynamic Y coordinate correction based on window positioning
        // The overlay window has windowY offset (usually 25px for macOS menu bar)
        // We need to account for this offset in the coordinate system
        const overlayYOffset = windowY; // This is the menu bar offset
        const coordinateSystemOffset = overlayYOffset * scaleFactor; // Scale the offset
        
        // Apply the dynamic offset correction
        correctedY = correctedY + coordinateSystemOffset;
        
        console.log('After device pixel ratio scaling:', { x: correctedX, y: correctedY, width, height });
        console.log('Applied scaling factor:', scaleFactor);
        console.log('Dynamic Y offset applied:', coordinateSystemOffset, '(window offset:', overlayYOffset, '× scale factor:', scaleFactor, ')');
        console.log('=== END DYNAMIC CORRECTION ===');
      } else {
        // Fallback: apply scaling correction if window data not available
        console.log('Using fallback coordinate correction');
        if (Math.abs(widthRatio - scaleFactor) > 0.1 || Math.abs(heightRatio - scaleFactor) > 0.1) {
          correctedX = Math.round(x * (widthRatio / scaleFactor));
          correctedY = Math.round(y * (heightRatio / scaleFactor));
          width = Math.round(width * (widthRatio / scaleFactor));
          height = Math.round(height * (heightRatio / scaleFactor));
        }
      }
      
      // Final coordinate assignment
      x = correctedX;
      y = correctedY;
      
      // Ensure bounds are within screenshot dimensions
      if (x >= maxWidth || y >= maxHeight) {
        console.warn(`Bounds may be out of range: x=${x}, y=${y}, max=${maxWidth}x${maxHeight}`);
      }
      
      // Adjust width and height if they exceed boundaries
      width = Math.min(width, maxWidth - x);
      height = Math.min(height, maxHeight - y);
      
      // Final validation
      if (x + width > maxWidth) {
        width = maxWidth - x;
      }
      if (y + height > maxHeight) {
        height = maxHeight - y;
      }
      
      // Ensure minimum size
      width = Math.max(1, width);
      height = Math.max(1, height);
      
      console.log('Final adjusted bounds:', { x, y, width, height });
      
      const timestamp = Date.now();
      const outputPath = path.join(this.tempDir, `capture_${timestamp}.png`);
      
      await sharp(fullScreenshot.filePath)
        .extract({
          left: x,
          top: y,
          width: width,
          height: height
        })
        .png()
        .toFile(outputPath);
      
      // Verify the output file was created and get its info
      const outputInfo = await sharp(outputPath).metadata();
      console.log('Output image info:', {
        width: outputInfo.width,
        height: outputInfo.height,
        path: outputPath
      });
      
      // Clean up the temporary full screenshot
      if (fs.existsSync(fullScreenshot.filePath)) {
        fs.unlinkSync(fullScreenshot.filePath);
      }
      
      console.log('Successfully captured area to:', outputPath);
      return outputPath;
    } catch (error) {
      console.error('Error capturing area:', error);
      throw error;
    }
  }

  async createImageWithTranslation(originalImagePath, originalText, translatedText, textBlocks) {
    try {
      const timestamp = Date.now();
      const outputPath = path.join(this.tempDir, `translated_${timestamp}.png`);
      
      // Load the original image
      const image = sharp(originalImagePath);
      const metadata = await image.metadata();
      const imageBuffer = await image.raw().toBuffer();
      
      // Ensure textBlocks is an array
      textBlocks = textBlocks || [];
      
      console.log('Creating intelligent text replacement with background color sampling');
      console.log('Text blocks to replace:', textBlocks.length);
      
      if (!textBlocks || textBlocks.length === 0) {
        console.log('No text blocks found, creating simple overlay');
        return await this.createSimpleOverlay(originalImagePath, translatedText, metadata);
      }

      // Smart text mapping: try to map translation to original text blocks more intelligently
      const translatedWords = translatedText.split(/\s+/).filter(word => word.length > 0);
      const originalWords = originalText.split(/\s+/).filter(word => word.length > 0);

      // Create mapping between original and translated text
      const textMapping = this.createIntelligentTextMapping(originalWords, translatedWords, textBlocks);

      // Create overlay elements for each text block
      const overlays = [];
      
      console.log('Processing text blocks for replacement:');
      
      // Check if we have phrase-aware mapping with consecutive groups
      const hasConsecutiveGroups = this.detectConsecutiveGroups(textBlocks, textMapping);
      
      if (hasConsecutiveGroups) {
        console.log('Creating combined overlays for phrase groups');
        await this.createCombinedPhraseOverlays(textBlocks, textMapping, overlays, imageBuffer, metadata);
      } else {
        // Original individual block processing
        for (let i = 0; i < textBlocks.length; i++) {
          const block = textBlocks[i];
          const mappedText = textMapping[i] || '';
          
          console.log(`\nProcessing block ${i}:`);
          console.log(`  Original text: "${block.text}"`);
          console.log(`  Mapped text: "${mappedText}"`);
          console.log(`  Has vertices: ${!!(block.vertices && block.vertices.length >= 4)}`);
          
          if (!block.vertices || block.vertices.length < 4) {
            console.log(`  Skipped: Invalid vertices`);
            continue;
          }
          
          if (!mappedText || mappedText.trim() === '') {
            console.log(`  Skipped: Empty mapped text`);
            continue;
          }
          
          await this.processSingleTextBlock(block, mappedText, i, overlays, imageBuffer, metadata);
        }
      }
      
      // Apply all overlays to the image
      await image
        .composite(overlays)
        .png()
        .toFile(outputPath);
      
      console.log('Created intelligent translated image:', outputPath);
      return outputPath;
    } catch (error) {
      console.error('Error creating translated image:', error);
      throw error;
    }
  }

  // Helper function to create intelligent text mapping
  createIntelligentTextMapping(originalWords, translatedWords, textBlocks) {
    const mapping = [];
    
    console.log('Text mapping debug:');
    console.log('Original words:', originalWords);
    console.log('Translated words:', translatedWords);
    console.log('Text blocks count:', textBlocks.length);
    
    // Calculate text block areas and sizes
    const blockSizes = textBlocks.map((block, i) => {
      if (!block.vertices || block.vertices.length < 4) return { index: i, area: 0, width: 0, height: 0 };

      const xs = block.vertices.map(v => v.x || 0);
      const ys = block.vertices.map(v => v.y || 0);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - left;
      const height = Math.max(...ys) - top;
      const area = width * height;

      return { index: i, area, width, height, text: block.text, left, top, right: left + width, bottom: top + height };
    });
    
    console.log('Block sizes:', blockSizes);
    
    // Special handling for common phrase patterns
    if (translatedWords.length === 2 && textBlocks.length > 2) {
      // Check if we have a title + multi-word phrase pattern
      const firstTranslation = translatedWords[0]; // e.g., "キャプチャ"
      const secondTranslation = translatedWords[1]; // e.g., "範囲選択でスクリーンショットを撮る"
      
      // Find consecutive blocks that could form the second phrase
      // Look for blocks that are on the same line or close vertically
      const consecutiveGroups = this.findConsecutiveTextBlocks(blockSizes.slice(1)); // Skip first block (title)
      
      console.log('Consecutive groups found:', consecutiveGroups);
      
      if (consecutiveGroups.length > 0) {
        // Use the largest consecutive group for the long translation
        const largestGroup = consecutiveGroups.reduce((max, group) => 
          group.totalArea > max.totalArea ? group : max);
        
        console.log('Using largest group for long translation:', largestGroup);
        
        // Map the first translation to the first (title) block
        mapping[0] = firstTranslation;
        
        // Map the long translation to the first block of the largest group
        const targetBlockIndex = largestGroup.blocks[0].index;
        mapping[targetBlockIndex] = secondTranslation;
        
        // Clear other blocks in the group to avoid duplication
        for (let i = 1; i < largestGroup.blocks.length; i++) {
          mapping[largestGroup.blocks[i].index] = '';
        }
        
        // Fill remaining blocks with original text if short
        for (let i = 0; i < textBlocks.length; i++) {
          if (mapping[i] === undefined) {
            const originalBlock = textBlocks[i];
            if (originalBlock && originalBlock.text && originalBlock.text.length <= 10) {
              mapping[i] = originalBlock.text;
            } else {
              mapping[i] = '';
            }
          }
        }
        
        console.log('Phrase-aware mapping:', mapping);
        return mapping;
      }
    }

    // Fallback to size-based mapping for other cases
    if (translatedWords.length === 1 && textBlocks.length > 1) {
      const sortedByArea = blockSizes.slice().sort((a, b) => b.area - a.area);
      const largestBlock = sortedByArea[0];
      
      for (let i = 0; i < textBlocks.length; i++) {
        if (i === largestBlock.index) {
          mapping[i] = translatedWords[0];
        } else {
          const originalBlock = textBlocks[i];
          if (originalBlock && originalBlock.text && originalBlock.text.length <= 12) {
            mapping[i] = originalBlock.text;
          } else {
            mapping[i] = '';
          }
        }
      }
    }
    else if (translatedWords.length <= textBlocks.length) {
      for (let i = 0; i < textBlocks.length; i++) {
        if (i < translatedWords.length) {
          mapping[i] = translatedWords[i];
        } else {
          const originalBlock = textBlocks[i];
          if (originalBlock && originalBlock.text && originalBlock.text.length <= 12) {
            mapping[i] = originalBlock.text;
          } else {
            mapping[i] = '';
          }
        }
      }
    } 
    else {
      const totalTranslatedLength = translatedWords.join(' ').length;
      const totalBlockArea = blockSizes.reduce((sum, block) => sum + block.area, 0);
      
      let translatedIndex = 0;
      
      for (let i = 0; i < textBlocks.length; i++) {
        const block = blockSizes[i];
        if (block.area === 0) {
          mapping[i] = '';
          continue;
        }
        
        const blockRatio = block.area / totalBlockArea;
        const wordsForThisBlock = Math.max(1, Math.round(translatedWords.length * blockRatio));
        
        const wordsToTake = [];
        for (let j = 0; j < wordsForThisBlock && translatedIndex < translatedWords.length; j++) {
          wordsToTake.push(translatedWords[translatedIndex]);
          translatedIndex++;
        }
        
        mapping[i] = wordsToTake.join(' ');
      }
      
      if (translatedIndex < translatedWords.length) {
        const remainingWords = translatedWords.slice(translatedIndex);
        const largestBlock = blockSizes.reduce((max, block) => 
          block.area > max.area ? block : max, blockSizes[0]);
        
        if (mapping[largestBlock.index]) {
          mapping[largestBlock.index] += ' ' + remainingWords.join(' ');
        }
      }
    }
    
    console.log('Final mapping:', mapping);
    return mapping;
  }

  // Helper function to find consecutive text blocks that likely form phrases
  findConsecutiveTextBlocks(blocks) {
    const groups = [];
    const processed = new Set();
    
    for (let i = 0; i < blocks.length; i++) {
      if (processed.has(i) || blocks[i].area === 0) continue;
      
      const group = { blocks: [blocks[i]], totalArea: blocks[i].area };
      processed.add(i);
      
      // Look for blocks that are on the same line (similar Y position) and close horizontally
      for (let j = i + 1; j < blocks.length; j++) {
        if (processed.has(j) || blocks[j].area === 0) continue;
        
        const yDiff = Math.abs(blocks[i].top - blocks[j].top);
        const heightTolerance = Math.max(blocks[i].height, blocks[j].height) * 0.5;
        
        // If blocks are on roughly the same line
        if (yDiff <= heightTolerance) {
          // Check if they're reasonably close horizontally
          const horizontalGap = Math.min(
            Math.abs(blocks[i].right - blocks[j].left),
            Math.abs(blocks[j].right - blocks[i].left)
          );
          
          if (horizontalGap <= 100) { // Max 100px gap
            group.blocks.push(blocks[j]);
            group.totalArea += blocks[j].area;
            processed.add(j);
          }
        }
      }
      
      // Only consider groups with multiple blocks
      if (group.blocks.length > 1) {
        // Sort blocks in the group by horizontal position
        group.blocks.sort((a, b) => a.left - b.left);
        groups.push(group);
      }
    }
    
    return groups;
  }

  // Helper function to sample background color from image
  async sampleBackgroundColor(imageBuffer, metadata, left, top, width, height) {
    try {
      const { width: imgWidth, height: imgHeight, channels } = metadata;
      
      // Sample multiple points around the text area to get average background color
      const samplePoints = [
        { x: Math.max(0, left - 5), y: Math.max(0, top - 5) },
        { x: Math.min(imgWidth - 1, left + width + 5), y: Math.max(0, top - 5) },
        { x: Math.max(0, left - 5), y: Math.min(imgHeight - 1, top + height + 5) },
        { x: Math.min(imgWidth - 1, left + width + 5), y: Math.min(imgHeight - 1, top + height + 5) },
        { x: left + width / 2, y: top + height / 2 }, // Center point
      ];
      
      let totalR = 0, totalG = 0, totalB = 0;
      let validSamples = 0;
      
      for (const point of samplePoints) {
        const pixelIndex = (point.y * imgWidth + point.x) * channels;
        if (pixelIndex + 2 < imageBuffer.length) {
          totalR += imageBuffer[pixelIndex];
          totalG += imageBuffer[pixelIndex + 1];
          totalB += imageBuffer[pixelIndex + 2];
          validSamples++;
        }
      }
      
      if (validSamples > 0) {
        const avgR = Math.round(totalR / validSamples);
        const avgG = Math.round(totalG / validSamples);
        const avgB = Math.round(totalB / validSamples);
        return `rgb(${avgR}, ${avgG}, ${avgB})`;
      }
      
      // Fallback to white if sampling fails
      return 'rgb(255, 255, 255)';
    } catch (error) {
      console.error('Error sampling background color:', error);
      return 'rgb(255, 255, 255)';
    }
  }

  // Helper function to determine contrasting text color
  getContrastingTextColor(backgroundColor) {
    try {
      // Extract RGB values
      const rgbMatch = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!rgbMatch) return '#000000';
      
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      
      // Calculate relative luminance
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      
      // Use dark text on light backgrounds, light text on dark backgrounds
      return luminance > 0.5 ? '#000000' : '#FFFFFF';
    } catch (error) {
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

  async createSimpleOverlay(imagePath, translatedText, metadata) {
    const timestamp = Date.now();
    const outputPath = path.join(this.tempDir, `translated_simple_${timestamp}.png`);
    
    const fontSize = Math.max(16, Math.min(32, Math.floor(metadata.width / 25)));
    const lineHeight = fontSize + 8;
    
    // Split translated text into lines
    const maxCharsPerLine = Math.floor(metadata.width / (fontSize * 0.6));
    const words = translatedText.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      if ((currentLine + word).length <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    const overlayHeight = Math.max(60, (lines.length * lineHeight) + 20);
    const overlayY = metadata.height - overlayHeight;
    
    const textLines = lines.map((line, index) => {
      const y = 25 + (index * lineHeight);
      return `<text x="15" y="${y}" font-family="Roboto, Arial, sans-serif" font-size="${fontSize}" fill="white" font-weight="400">${
        this.escapeXml(line)
      }</text>`;
    }).join('');
    
    const svgOverlay = `
      <svg width="${metadata.width}" height="${overlayHeight}">
        <rect width="${metadata.width}" height="${overlayHeight}" fill="rgba(0, 0, 0, 0.8)" rx="5"/>
        ${textLines}
      </svg>
    `;
    
    await sharp(imagePath)
      .composite([{ 
        input: Buffer.from(svgOverlay), 
        top: overlayY, 
        left: 0 
      }])
      .png()
      .toFile(outputPath);
    
    return outputPath;
  }

  // Helper function to detect consecutive groups in text blocks
  detectConsecutiveGroups(textBlocks, textMapping) {
    // Check if we have empty mappings that indicate consecutive group clearing
    let hasEmptyMappings = false;
    let hasNonEmptyMappings = false;
    
    for (let i = 0; i < textMapping.length; i++) {
      if (textMapping[i] === '') {
        hasEmptyMappings = true;
      } else if (textMapping[i] && textMapping[i].trim() !== '') {
        hasNonEmptyMappings = true;
      }
    }
    
    return hasEmptyMappings && hasNonEmptyMappings;
  }

  // Helper function to create combined phrase overlays
  async createCombinedPhraseOverlays(textBlocks, textMapping, overlays, imageBuffer, metadata) {
    let i = 0;
    while (i < textBlocks.length) {
      const mappedText = textMapping[i] || '';
      const block = textBlocks[i];
      
      if (!mappedText || mappedText.trim() === '' || !block.vertices || block.vertices.length < 4) {
        i++;
        continue;
      }
      
      // Check if this is the start of a phrase group (non-empty followed by empties)
      let isStartOfPhrase = false;
      let phraseEndIndex = i;
      
      if (mappedText.length > 20) { // Long translation likely spans multiple blocks
        // Look ahead for empty mappings (cleared consecutive blocks)
        for (let j = i + 1; j < textBlocks.length; j++) {
          if (textMapping[j] === '') {
            isStartOfPhrase = true;
            phraseEndIndex = j;
          } else {
            break;
          }
        }
      }
      
      if (isStartOfPhrase) {
        console.log(`Creating combined phrase overlay from block ${i} to ${phraseEndIndex}`);
        await this.createCombinedOverlay(textBlocks, i, phraseEndIndex, mappedText, overlays, imageBuffer, metadata);
        i = phraseEndIndex + 1;
      } else {
        console.log(`Processing single block ${i}: "${block.text}" -> "${mappedText}"`);
        await this.processSingleTextBlock(block, mappedText, i, overlays, imageBuffer, metadata);
        i++;
      }
    }
  }

  // Helper function to process a single text block
  async processSingleTextBlock(block, mappedText, i, overlays, imageBuffer, metadata) {
    // Calculate bounding box from vertices
    const xs = block.vertices.map(v => v.x || 0);
    const ys = block.vertices.map(v => v.y || 0);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    const width = right - left;
    const height = bottom - top;
    
    console.log(`  Dimensions: ${width}x${height} at (${left},${top})`);
    
    // Skip if dimensions are too small
    if (width < 8 || height < 8) {
      console.log(`  Skipped: Dimensions too small`);
      return;
    }
    
    // Use Google Translate style: semi-transparent white background with dark text
    const backgroundColor = 'rgba(255, 255, 255, 0.9)'; // Semi-transparent white
    const textColor = '#000000'; // Always dark text for readability
    
    // Calculate appropriate font size based on original text area
    const fontSize = Math.max(10, Math.min(height * 0.7, 32));
    
    console.log(`Block ${i}: "${block.text}" -> "${mappedText}" at (${left},${top}) ${width}x${height}`);
    console.log(`Google Translate style: Background: ${backgroundColor}, Text: ${textColor}, Font: ${fontSize}px`);
    
    // Create background rectangle with Google Translate style
    const backgroundSvg = `
      <svg width="${width + 6}" height="${height + 6}">
        <rect width="${width + 6}" height="${height + 6}" 
              fill="white" 
              fill-opacity="0.9" 
              stroke="none" 
              rx="2"/>
      </svg>
    `;
    
    // Calculate text positioning for better centering
    const textX = (width + 6) / 2;
    const textY = (height + 6) / 2;
    
    // Create text overlay with proper sizing and positioning
    const textSvg = `
      <svg width="${width + 6}" height="${height + 6}">
        <defs>
          <style>
            .translated-text {
              font-family: 'Roboto', 'Helvetica Neue', 'Arial', sans-serif;
              font-size: ${fontSize}px;
              font-weight: 400;
              fill: ${textColor};
              text-anchor: middle;
              dominant-baseline: central;
            }
          </style>
        </defs>
        <text x="${textX}" y="${textY}" class="translated-text">
          ${this.escapeXml(mappedText)}
        </text>
      </svg>
    `;
    
    // Add background overlay first
    overlays.push({
      input: Buffer.from(backgroundSvg),
      top: Math.max(0, top - 3),
      left: Math.max(0, left - 3),
    });
    
    // Add text overlay on top
    overlays.push({
      input: Buffer.from(textSvg),
      top: Math.max(0, top - 3),
      left: Math.max(0, left - 3),
    });
  }

  // Helper function to create a combined overlay spanning multiple text blocks
  async createCombinedOverlay(textBlocks, startIndex, endIndex, text, overlays, imageBuffer, metadata) {
    // Calculate combined bounding box for all blocks in the phrase
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    
    for (let i = startIndex; i <= Math.min(endIndex, textBlocks.length - 1); i++) {
      const block = textBlocks[i];
      if (!block.vertices || block.vertices.length < 4) continue;
      
      const xs = block.vertices.map(v => v.x || 0);
      const ys = block.vertices.map(v => v.y || 0);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const right = Math.max(...xs);
      const bottom = Math.max(...ys);
      
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    }
    
    if (minLeft === Infinity) return; // No valid blocks found
    
    const combinedWidth = maxRight - minLeft;
    const combinedHeight = maxBottom - minTop;
    
    console.log(`Combined area: ${combinedWidth}x${combinedHeight} at (${minLeft},${minTop})`);
    
    // Use Google Translate style for combined overlays too
    const backgroundColor = 'rgba(255, 255, 255, 0.9)';
    const textColor = '#000000';
    
    // Calculate font size based on combined area
    const fontSize = Math.max(12, Math.min(combinedHeight * 0.6, 24));
    
    console.log(`Combined Google Translate overlay: Background: ${backgroundColor}, Text: ${textColor}, Font: ${fontSize}px`);
    
    // Create combined background rectangle
    const backgroundSvg = `
      <svg width="${combinedWidth + 8}" height="${combinedHeight + 8}">
        <rect width="${combinedWidth + 8}" height="${combinedHeight + 8}" 
              fill="white" 
              fill-opacity="0.9" 
              stroke="none" 
              rx="3"/>
      </svg>
    `;
    
    // Create text overlay positioned in the center of combined area
    const textX = (combinedWidth + 8) / 2;
    const textY = (combinedHeight + 8) / 2;
    
    const textSvg = `
      <svg width="${combinedWidth + 8}" height="${combinedHeight + 8}">
        <defs>
          <style>
            .combined-text {
              font-family: 'Roboto', 'Helvetica Neue', 'Arial', sans-serif;
              font-size: ${fontSize}px;
              font-weight: 400;
              fill: ${textColor};
              text-anchor: middle;
              dominant-baseline: central;
            }
          </style>
        </defs>
        <text x="${textX}" y="${textY}" class="combined-text">
          ${this.escapeXml(text)}
        </text>
      </svg>
    `;
    
    // Add combined overlays
    overlays.push({
      input: Buffer.from(backgroundSvg),
      top: Math.max(0, minTop - 4),
      left: Math.max(0, minLeft - 4),
    });
    
    overlays.push({
      input: Buffer.from(textSvg),
      top: Math.max(0, minTop - 4),
      left: Math.max(0, minLeft - 4),
    });
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