import type { SupportedLanguage } from './_all';
import type { TranslationStructure } from './_types';
import { en } from './translations/en';

/**
 * The web export ships the English tree and fetches the reader's language as its own chunk. Every
 * locale in the entry chunk cost ~0.5 MB of parse each (7 MB for the twelve), while an English
 * reader needs none of them and most readers need exactly one.
 *
 * The readers are reached through `import()`, so Metro splits each one into a chunk that is fetched
 * on demand instead of being parsed before the first paint. Until the chunk lands, `getLocaleTree`
 * answers with English: a translation that arrives a moment late is better than a bundle that
 * delays every paint.
 */
const LOCALE_LOADERS: Record<SupportedLanguage, () => Promise<TranslationStructure>> = {
    // English is in the entry chunk; the entry keeps the map total so a new language cannot ship
    // without a loader.
    en: () => Promise.resolve(en),
    ru: () => import('./translations/ru').then((module) => module.ru),
    pl: () => import('./translations/pl').then((module) => module.pl),
    es: () => import('./translations/es').then((module) => module.es),
    fr: () => import('./translations/fr').then((module) => module.fr),
    it: () => import('./translations/it').then((module) => module.it),
    pt: () => import('./translations/pt').then((module) => module.pt),
    ca: () => import('./translations/ca').then((module) => module.ca),
    de: () => import('./translations/de').then((module) => module.de),
    'zh-Hans': () => import('./translations/zh-Hans').then((module) => module.zhHans),
    'zh-Hant': () => import('./translations/zh-Hant').then((module) => module.zhHant),
    ja: () => import('./translations/ja').then((module) => module.ja),
};

const loadedTrees = new Map<SupportedLanguage, TranslationStructure>();
const pendingLoads = new Map<SupportedLanguage, Promise<void>>();

export { en as englishTranslationTree };

export function getLocaleTree(language: SupportedLanguage): TranslationStructure {
    if (language === 'en') return en;
    const loaded = loadedTrees.get(language);
    if (loaded) return loaded;
    // A lookup is the earliest proof that this language is in use, so it also starts the load.
    void ensureLocaleTree(language);
    return en;
}

export function ensureLocaleTree(language: SupportedLanguage): Promise<void> {
    if (language === 'en' || loadedTrees.has(language)) return Promise.resolve();
    const pending = pendingLoads.get(language);
    if (pending) return pending;

    const promise = LOCALE_LOADERS[language]()
        .then((tree) => {
            loadedTrees.set(language, tree);
        })
        .catch((error: unknown) => {
            // Stay on English for this session instead of failing a render.
            console.error(`Failed to load the ${language} translations:`, error);
        })
        .finally(() => {
            pendingLoads.delete(language);
        });
    pendingLoads.set(language, promise);
    return promise;
}
