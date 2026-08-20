import type { FieldType } from '../data/types';
import type { MessageKey } from '../i18n/messages';

const FIELD_TYPE_KEYS: Record<FieldType, MessageKey> = {
  text: 'fieldtype.text',
  integer: 'fieldtype.integer',
  number: 'fieldtype.number',
  date: 'fieldtype.date',
  datetime: 'fieldtype.datetime',
  boolean: 'fieldtype.boolean',
  select: 'fieldtype.select',
  multiselect: 'fieldtype.multiselect',
  terminology: 'fieldtype.terminology',
};

export function fieldTypeLabel(t: (key: MessageKey) => string, type: FieldType): string {
  return t(FIELD_TYPE_KEYS[type]);
}
