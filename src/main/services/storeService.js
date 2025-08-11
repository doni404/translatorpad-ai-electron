const Store = require('electron-store');

// Define the schema for our settings
const schema = {
	shortcuts: {
		type: 'object',
		properties: {
			'capture-translate': {
				type: 'string',
				default: 'CommandOrControl+Shift+S'
			},
			'translate-paste': {
				type: 'string',
				default: 'CommandOrControl+Shift+T'
			},
			'ai-translate-paste': {
				type: 'string',
				default: 'CommandOrControl+Shift+Y'
			}
		},
		default: {}
	},
	targetLanguage: {
		type: 'string',
		default: 'ja'
	},
	openAISettings: {
		type: 'object',
		properties: {
			model: { type: 'string', default: 'gpt4' },
			prompt: { type: 'string', default: 'Improve the grammar, clarity, and politeness of the following text, then translate it into [TARGET_LANGUAGE]. Keep meaning intact, be concise and natural, and suitable for professional communication. Return only the final text with no explanations.' },
			apiKey: { type: 'string', default: '' }
		},
		default: {}
	}
};

class StoreService {
    constructor() {
        this.store = new Store({ schema });
        console.log('🏪 StoreService initialized');
        console.log('📂 Store file path:', this.store.path);

        // Ensure defaults are set on first run
        const existingShortcuts = this.store.get('shortcuts');
        const defaults = this.getDefaultShortcuts();
        const mergedShortcuts = {
            ...defaults,
            ...existingShortcuts
        };
        if (mergedShortcuts['copy-last-translation']) {
            delete mergedShortcuts['copy-last-translation'];
        }
        this.store.set('shortcuts', mergedShortcuts);
        
        // Initialize OpenAI settings with defaults if missing
        const existingOpenAI = this.store.get('openAISettings') || {};
        const defaultOpenAI = this.getDefaultOpenAISettings();
        this.store.set('openAISettings', { ...defaultOpenAI, ...existingOpenAI });
    }

    getDefaultShortcuts() {
        const defaults = {
            'capture-translate': 'CommandOrControl+Shift+S',
            'translate-paste': 'CommandOrControl+Shift+T',
            'ai-translate-paste': 'CommandOrControl+Shift+Y'
        };
        return defaults;
    }

    getDefaultOpenAISettings() {
        return {
            model: 'gpt4',
            prompt: 'Improve the grammar, clarity, and politeness of the following text, then translate it into [TARGET_LANGUAGE]. Keep meaning intact, be concise and natural, and suitable for professional communication. Return only the final text with no explanations. \n\nAlways at the first say “[Translated by xxx Model/n[Content]”, fill xxx with model name used.',
            apiKey: ''
        };
    }

    getShortcuts() {
        return this.store.get('shortcuts');
    }

    getTargetLanguage() {
        return this.store.get('targetLanguage');
    }
    
    setShortcuts(shortcuts) {
        this.store.set('shortcuts', shortcuts);
    }

    setTargetLanguage(language) {
        this.store.set('targetLanguage', language);
    }

    _normalizeModel(model) {
        if (!model || typeof model !== 'string') return 'gpt4';
        const m = model.toLowerCase().trim();
        if (m === 'gpt-5') return 'gpt5';
        if (m === 'gpt-4') return 'gpt4';
        if (m === 'gpt-3') return 'gpt3';
        if (['gpt5','gpt4','gpt3'].includes(m)) return m;
        return 'gpt4';
    }

    getOpenAISettings() {
        const current = this.store.get('openAISettings') || {};
        const normalized = { ...this.getDefaultOpenAISettings(), ...current };
        normalized.model = this._normalizeModel(normalized.model);
        if (normalized.model !== current.model) {
            this.store.set('openAISettings', normalized);
        }
        console.log('🧠 Retrieved OpenAI settings:', { ...normalized, apiKey: normalized?.apiKey ? '***' : '' });
        return normalized;
    }

    setOpenAISettings(settings) {
        const current = this.store.get('openAISettings') || {};
        const next = { ...current, ...settings };
        next.model = this._normalizeModel(next.model);
        this.store.set('openAISettings', next);
    }

    resetOpenAISettings() {
        const defaults = this.getDefaultOpenAISettings();
        this.store.set('openAISettings', defaults);
        return defaults;
    }

    resetShortcuts() {
        const defaults = this.getDefaultShortcuts();
        this.setShortcuts(defaults);
        return defaults;
    }
}

module.exports = { StoreService }; 