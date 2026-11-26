import type { SupportedLanguage } from './_all';
import type { TranslationStructure } from './_types';
import { ca } from './translations/ca';
import { de } from './translations/de';
import { en } from './translations/en';
import { es } from './translations/es';
import { fr } from './translations/fr';
import { it } from './translations/it';
import { ja } from './translations/ja';
import { pl } from './translations/pl';
import { pt } from './translations/pt';
import { ru } from './translations/ru';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';

/**
 * Locale trees are ~0.5 MB of source each and only one of them is ever the active language, yet
 * every one of them used to be materialized before the app could paint.
 *
 * Metro runs with `inlineRequires` enabled (`apps/ui/metro.config.js`), which moves an imported
 * binding's `require` to the place the binding is referenced — but a module-scope `{ en, ru, ... }`
 * map is itself such a reference, so importing `t()` evaluated all ten locale modules at import
 * time. Referencing each tree from inside a thunk defers its `require` to the first lookup for that
 * language, which in practice means the active language and the English fallback. Where inline
 * requires are not applied (vitest), the thunks are ordinary closures and behaviour is unchanged.
 *
 * Native and tests keep every locale in the bundle: Hermes has no chunk loader worth the round trip
 * and a test must be able to switch language synchronously. The web export overrides this module
 * with `localeTrees.web.ts`, which ships English only and fetches the reader's language as a chunk.
 */
const TRANSLATION_TREE_BY_LANGUAGE = {
    en: () => en,
    ru: () => ru,
    pl: () => pl,
    es: () => es,
    fr: () => fr,
    it: () => it,
    pt: () => pt,
    ca: () => ca,
    de: () => de,
    'zh-Hans': () => zhHans,
    'zh-Hant': () => zhHant,
    ja: () => ja,
} satisfies Record<SupportedLanguage, () => TranslationStructure>;

export { en as englishTranslationTree };

export function getLocaleTree(language: SupportedLanguage): TranslationStructure {
    const loadTree = TRANSLATION_TREE_BY_LANGUAGE[language];
    return loadTree ? loadTree() : en;
}

/** Every locale is in the bundle on this platform, so there is nothing to wait for. */
export async function ensureLocaleTree(language: SupportedLanguage): Promise<void> {
    void language;
}
