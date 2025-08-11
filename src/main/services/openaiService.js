const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');

class OpenAIService {
  constructor(storeService) {
    this.storeService = storeService;
    this.apiKey = null;
    this.client = null;
    this._initializeClient();
  }

  _readApiKeyFromCredentials() {
    try {
      const credentialsPath = path.join(__dirname, '../../../credentials/openai-key.json');
      if (fs.existsSync(credentialsPath)) {
        const content = fs.readFileSync(credentialsPath, 'utf8');
        const json = JSON.parse(content);
        const key = json.apiKey || json.key || json.OPENAI_API_KEY || json.token;
        if (key && key.trim()) {
          return key.trim();
        }
      }
    } catch (e) {
      console.warn('Failed to read OpenAI credentials file:', e.message);
    }
    return null;
  }

  _initializeClient() {
    try {
      const fileKey = this._readApiKeyFromCredentials();
      const envKey = process.env.OPENAI_API_KEY;
      const apiKey = fileKey || envKey;

      if (!apiKey || !apiKey.trim()) {
        this.apiKey = null;
        this.client = null;
        console.warn('OpenAI API key not found (credentials/openai-key.json or OPENAI_API_KEY). OpenAI features disabled.');
        return;
      }
      this.apiKey = apiKey.trim();
      this.client = new OpenAI({ apiKey: this.apiKey });
    } catch (error) {
      console.error('Failed to initialize OpenAI API key:', error.message);
      this.apiKey = null;
      this.client = null;
    }
  }

  _resolveModel(selected) {
    switch ((selected || '').toLowerCase()) {
      case 'gpt5':
      case 'gpt-5':
        return 'gpt-5-nano';
      case 'gpt4':
      case 'gpt-4':
        return 'gpt-4.1-nano';
      case 'gpt3':
      case 'gpt-3':
        return 'gpt-3.5-turbo';
      default:
        return selected || 'gpt-4.1-nano';
    }
  }

  _displayModelName(selected) {
    const sel = (selected || '').toLowerCase();
    if (sel.startsWith('gpt5') || sel === 'gpt-5') return 'gpt-5-nano';
    if (sel.startsWith('gpt4') || sel === 'gpt-4') return 'gpt-4.1-nano';
    if (sel.startsWith('gpt3') || sel === 'gpt-3') return 'gpt-3.5';
    return 'gpt-4.1-nano';
  }

  _getDefaultPrompt() {
    return (
      'Improve the grammar, clarity, and politeness of the following text, then translate it into [TARGET_LANGUAGE]. ' +
      'Keep meaning intact, be concise and natural, and suitable for professional communication. ' +
      'Return only the final text with no explanations.'
    );
  }

  refreshClient() {
    this._initializeClient();
  }

  async improveAndTranslate(text, targetLanguage, overridePrompt, selectedModel) {
    if (!text || !text.trim()) {
      throw new Error('No text provided.');
    }

    if (!this.apiKey || !this.client) {
      this._initializeClient();
    }

    if (!this.apiKey || !this.client) {
      throw new Error('OpenAI API key/client not initialized. Please provide credentials in credentials/openai-key.json or set OPENAI_API_KEY.');
    }

    const settings = this.storeService.getOpenAISettings ? this.storeService.getOpenAISettings() : {};
    const selected = (selectedModel || settings.model || 'gpt4');
    const model = this._resolveModel(selected);
    const displayModel = this._displayModelName(selected);

    const basePrompt = (overridePrompt && overridePrompt.trim()) || settings.prompt || this._getDefaultPrompt();
    const preparedPrompt = basePrompt
      .replace(/\[TARGET_LANGUAGE\]/g, targetLanguage || 'en')
      .replace(/\[MODEL_NAME\]/g, displayModel)
      .replace(/\bxxx\b/gi, displayModel)
      .replace(/\/n/g, '\n');

    const systemMessage = `You are a writing and translation assistant. Follow user instructions precisely. If text is already in the target language, improve it. Return exactly one single result in the requested format and do not repeat content or include multiple versions.`;
    const userMessage = `${preparedPrompt}\n\n---\nInput:\n${text}`;

    const payload = {
      model,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ]
    };

    // For gpt-5 variants, do not set any extra params (let server defaults apply)
    const modelLower = model.toLowerCase();
    if (modelLower !== 'gpt-5' && modelLower !== 'gpt-5-nano') {
      payload.max_tokens = 1000;
      payload.temperature = 0.2;
    }

    try {
      const response = await this.client.chat.completions.create(payload);
      const content = response?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('No content returned from OpenAI.');
      return content;
    } catch (error) {
      const code = error?.status || error?.code;
      if (code === 401) {
        throw new Error('OpenAI authentication failed. Check credentials/openai-key.json or OPENAI_API_KEY.');
      }
      if (code === 404) {
        throw new Error(`Model "${model}" not found or not available for your key. Please verify access or choose another model in Settings.`);
      }
      if (code === 429) {
        throw new Error('OpenAI rate limit reached. Please try again later.');
      }
      if (code === 400) {
        throw new Error('OpenAI request invalid. Please adjust prompt or model.');
      }
      throw new Error(`OpenAI error: ${error.message || 'Unknown error'}`);
    }
  }
}

module.exports = { OpenAIService }; 