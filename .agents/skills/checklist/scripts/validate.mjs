#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TOP_LEVEL_FIELDS = new Set(['title', 'summary', 'intro', 'callout', 'conventions', 'sections']);
const SECTION_FIELDS = new Set(['number', 'title', 'kind', 'intro', 'items']);
const ITEM_FIELDS = new Set([
  'id',
  'title',
  'instruction',
  'expectedResult',
  'codeBlocks',
  'links',
  'optional',
  'warning',
  'failureGuidance',
  'subItems',
]);
const SUB_ITEM_FIELDS = new Set([...ITEM_FIELDS].filter((field) => field !== 'subItems'));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknownFields(value, allowed, path, errors) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${path}.${field} is not allowed`);
  }
}

function validateOptionalString(value, path, errors) {
  if (value !== undefined && typeof value !== 'string') errors.push(`${path} must be a string`);
}

function validateCodeBlocks(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((block, index) => {
    const blockPath = `${path}[${index}]`;
    if (!isObject(block)) {
      errors.push(`${blockPath} must be an object`);
      return;
    }
    rejectUnknownFields(block, new Set(['language', 'content']), blockPath, errors);
    if (!nonEmptyString(block.language)) errors.push(`${blockPath}.language must be a non-empty string`);
    if (typeof block.content !== 'string') errors.push(`${blockPath}.content must be a string`);
  });
}

function validateLinks(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((link, index) => {
    const linkPath = `${path}[${index}]`;
    if (!isObject(link)) {
      errors.push(`${linkPath} must be an object`);
      return;
    }
    rejectUnknownFields(link, new Set(['label', 'url']), linkPath, errors);
    for (const field of ['label', 'url']) {
      if (!nonEmptyString(link[field])) errors.push(`${linkPath}.${field} must be a non-empty string`);
    }
  });
}

function validateItem(item, path, ids, errors, subItem = false) {
  if (!isObject(item)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownFields(item, subItem ? SUB_ITEM_FIELDS : ITEM_FIELDS, path, errors);
  for (const field of ['id', 'title']) {
    if (!nonEmptyString(item[field])) errors.push(`${path}.${field} must be a non-empty string`);
  }
  if (nonEmptyString(item.id)) {
    if (ids.has(item.id)) errors.push(`${path}.id duplicates "${item.id}"`);
    ids.add(item.id);
  }
  for (const field of ['instruction', 'expectedResult', 'warning', 'failureGuidance']) {
    validateOptionalString(item[field], `${path}.${field}`, errors);
  }
  if (item.optional !== undefined && typeof item.optional !== 'boolean') {
    errors.push(`${path}.optional must be a boolean`);
  }
  validateCodeBlocks(item.codeBlocks, `${path}.codeBlocks`, errors);
  validateLinks(item.links, `${path}.links`, errors);

  if (subItem || item.subItems === undefined) return;
  if (!Array.isArray(item.subItems)) {
    errors.push(`${path}.subItems must be an array`);
    return;
  }
  item.subItems.forEach((child, index) => validateItem(child, `${path}.subItems[${index}]`, ids, errors, true));
}

export function validateChecklist(checklist) {
  const errors = [];
  const ids = new Set();
  if (!isObject(checklist)) return ['$ must be an object'];

  rejectUnknownFields(checklist, TOP_LEVEL_FIELDS, '$', errors);
  for (const field of ['title', 'summary']) {
    if (!nonEmptyString(checklist[field])) errors.push(`$.${field} must be a non-empty string`);
  }
  for (const field of ['intro', 'callout', 'conventions']) {
    validateOptionalString(checklist[field], `$.${field}`, errors);
  }
  if (!Array.isArray(checklist.sections) || checklist.sections.length === 0) {
    errors.push('$.sections must be a non-empty array');
    return errors;
  }

  checklist.sections.forEach((section, sectionIndex) => {
    const sectionPath = `$.sections[${sectionIndex}]`;
    if (!isObject(section)) {
      errors.push(`${sectionPath} must be an object`);
      return;
    }
    rejectUnknownFields(section, SECTION_FIELDS, sectionPath, errors);
    for (const field of ['number', 'title']) {
      if (!nonEmptyString(section[field])) errors.push(`${sectionPath}.${field} must be a non-empty string`);
    }
    if (!['checklist', 'info'].includes(section.kind)) {
      errors.push(`${sectionPath}.kind must be "checklist" or "info"`);
    }
    validateOptionalString(section.intro, `${sectionPath}.intro`, errors);
    if (!Array.isArray(section.items) || section.items.length === 0) {
      errors.push(`${sectionPath}.items must be a non-empty array`);
      return;
    }
    section.items.forEach((item, itemIndex) => validateItem(item, `${sectionPath}.items[${itemIndex}]`, ids, errors));
  });

  return errors;
}

export async function loadAndValidateChecklist(path) {
  let checklist;
  try {
    checklist = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return { errors: [`Unable to read valid JSON: ${error.message}`] };
  }
  const errors = validateChecklist(checklist);
  return errors.length === 0 ? { checklist, errors } : { errors };
}

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) {
    console.error('Usage: node validate.mjs <checklist.json>');
    process.exitCode = 1;
    return;
  }
  const { errors } = await loadAndValidateChecklist(path);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
