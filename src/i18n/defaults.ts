import { createBlankDocument } from '../data/seed';
import type { FlowLabelDefaults } from '../model/spaces';
import { t } from './locale';

export function createLocalizedBlankDocument() {
  return createBlankDocument(t('未命名思维'));
}
export function localizedFlowLabels(): FlowLabelDefaults {
  return { branch: t('分支 {0}', '').trim(), main: t('主线'), yes: t('是'), no: t('否') };
}
