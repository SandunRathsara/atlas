(function () {
  'use strict';

  var STATES = ['not-started', 'complete', 'failed', 'blocked', 'not-applicable'];
  var STATE_LABELS = {
    'not-started': 'Not started',
    complete: 'Complete',
    failed: 'Failed',
    blocked: 'Blocked',
    'not-applicable': 'Not applicable',
  };
  var payload = window.BEARINGS_CHECKLISTS;
  var currentEntry = null;
  var currentStates = {};
  var storageAvailable = true;
  var refreshPending = false;

  var picker = document.getElementById('checklist-picker');
  var content = document.getElementById('content');
  var status = document.getElementById('status');
  var warning = document.getElementById('storage-warning');

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function reportStorageFailure() {
    storageAvailable = false;
    warning.hidden = false;
    warning.textContent = 'Browser storage is unavailable. Progress works in this tab only; use Export to keep a copy.';
  }

  function storageKey(entry) {
    return 'bearings-checklists:' + payload.repositoryId + ':' + entry.identity;
  }

  function executableIds(entry) {
    var ids = [];
    entry.checklist.sections.forEach(function (section) {
      if (section.kind === 'info') return;
      section.items.forEach(function (item) {
        ids.push(item.id);
        (item.subItems || []).forEach(function (subItem) { ids.push(subItem.id); });
      });
    });
    return ids;
  }

  function normalizedStates(entry, candidate) {
    var states = {};
    executableIds(entry).forEach(function (id) {
      if (candidate && STATES.indexOf(candidate[id]) !== -1 && candidate[id] !== 'not-started') {
        states[id] = candidate[id];
      }
    });
    return states;
  }

  function loadProgress(entry) {
    if (!storageAvailable) return {};
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey(entry)) || 'null');
      if (!saved || saved.contentHash !== entry.contentHash) return {};
      return normalizedStates(entry, saved.states);
    } catch (error) {
      reportStorageFailure();
      return {};
    }
  }

  function progressRecord() {
    return {
      repositoryId: payload.repositoryId,
      checklistIdentity: currentEntry.identity,
      contentHash: currentEntry.contentHash,
      states: currentStates,
      updatedAt: new Date().toISOString(),
    };
  }

  function saveProgress() {
    if (!currentEntry || !storageAvailable) return;
    try {
      localStorage.setItem(storageKey(currentEntry), JSON.stringify(progressRecord()));
      setStatus('Progress saved in this browser.');
    } catch (error) {
      reportStorageFailure();
      setStatus('Progress changed, but browser storage could not save it.');
    }
  }

  function updateProgress() {
    var ids = currentEntry ? executableIds(currentEntry) : [];
    var resolved = ids.filter(function (id) {
      return currentStates[id] && currentStates[id] !== 'not-started';
    }).length;
    document.getElementById('progress-copy').textContent = resolved + ' / ' + ids.length + ' resolved';
    document.getElementById('progress-fill').style.width = (ids.length ? resolved / ids.length * 100 : 0) + '%';
  }

  function textBlock(className, label, value) {
    var block = element('div', className);
    block.append(element('span', 'field-label', label), document.createTextNode(value));
    return block;
  }

  function safeLink(link) {
    var item = element('li');
    var anchor = element('a', '', link.label);
    try {
      var parsed = new URL(link.url);
      if (['http:', 'https:', 'mailto:'].indexOf(parsed.protocol) === -1) throw new Error('unsupported protocol');
      anchor.href = parsed.href;
      anchor.rel = 'noreferrer';
      if (parsed.protocol !== 'mailto:') anchor.target = '_blank';
    } catch (error) {
      anchor = element('span', '', link.label + ' (unsafe link omitted)');
    }
    item.append(anchor);
    return item;
  }

  function stateControl(item, article) {
    var label = element('label', 'state-label', 'State');
    var select = element('select', 'state-select');
    select.setAttribute('aria-label', 'State for ' + item.id + ': ' + item.title);
    STATES.forEach(function (stateName) {
      var option = element('option', '', STATE_LABELS[stateName]);
      option.value = stateName;
      select.append(option);
    });
    select.value = currentStates[item.id] || 'not-started';
    article.dataset.state = select.value;
    select.addEventListener('change', function () {
      if (select.value === 'not-started') delete currentStates[item.id];
      else currentStates[item.id] = select.value;
      article.dataset.state = select.value;
      saveProgress();
      updateProgress();
    });
    label.append(select);
    return label;
  }

  function renderItem(item, kind, isSubItem) {
    var article = element('article', 'item' + (kind === 'info' ? ' info' : ''));
    var head = element('div', 'item-head');
    var headingWrap = element('div', 'item-heading');
    var heading = element(isSubItem ? 'h4' : 'h3');
    heading.append(element('span', 'item-id', item.id), document.createTextNode(item.title));
    if (item.optional) heading.append(element('span', 'optional', 'Optional'));
    headingWrap.append(heading);
    head.append(headingWrap);
    if (kind === 'checklist') head.append(stateControl(item, article));
    article.append(head);

    if (item.warning) article.append(textBlock('warning', 'Warning', item.warning));
    if (item.instruction) article.append(element('p', 'instruction', item.instruction));
    (item.codeBlocks || []).forEach(function (block) {
      var pre = element('pre');
      pre.append(element('span', 'language', block.language), element('code', '', block.content));
      article.append(pre);
    });
    if (item.expectedResult) article.append(textBlock('expected', 'Expected result', item.expectedResult));
    if (item.failureGuidance) article.append(textBlock('failure', 'If this fails', item.failureGuidance));
    if (item.links && item.links.length) {
      var links = element('ul', 'links');
      item.links.forEach(function (link) { links.append(safeLink(link)); });
      article.append(links);
    }
    if (item.subItems && item.subItems.length) {
      var subItems = element('div', 'sub-items');
      item.subItems.forEach(function (subItem) { subItems.append(renderItem(subItem, kind, true)); });
      article.append(subItems);
    }
    return article;
  }

  function renderChecklist(entry, inMemoryStates) {
    currentEntry = entry;
    currentStates = inMemoryStates === undefined ? loadProgress(entry) : normalizedStates(entry, inMemoryStates);
    var checklist = entry.checklist;
    document.title = checklist.title + ' - Checklist';
    document.getElementById('title').textContent = checklist.title;
    document.getElementById('summary').textContent = checklist.summary;
    content.className = '';
    content.replaceChildren();
    if (checklist.intro) content.append(element('p', 'intro', checklist.intro));
    if (checklist.callout) content.append(element('div', 'callout', checklist.callout));
    if (checklist.conventions) content.append(element('div', 'conventions', checklist.conventions));

    checklist.sections.forEach(function (section) {
      var sectionElement = element('section');
      var heading = element('div', 'section-heading');
      heading.append(element('span', 'section-number', section.number), element('h2', '', section.title));
      sectionElement.append(heading);
      if (section.intro) sectionElement.append(element('p', 'section-intro', section.intro));
      var items = element('div', 'items');
      section.items.forEach(function (item) { items.append(renderItem(item, section.kind, false)); });
      sectionElement.append(items);
      content.append(sectionElement);
    });
    updateProgress();
    setStatus('Opened ' + entry.identity + '.');
  }

  function showMessage(message, isError) {
    currentEntry = null;
    currentStates = {};
    document.title = 'Checklist library';
    document.getElementById('title').textContent = 'Choose a checklist';
    document.getElementById('summary').textContent = 'Browse the checklists generated from this repository.';
    content.className = isError ? 'error' : 'empty';
    content.textContent = message;
    updateProgress();
  }

  function renderLibrary(selectedIdentity) {
    document.documentElement.dataset.viewerReady = 'false';
    picker.replaceChildren(element('option', '', payload && payload.checklists.length ? 'Choose a checklist...' : 'No checklists found'));
    picker.firstChild.value = '';
    if (!payload || !Array.isArray(payload.checklists)) {
      showMessage('No generated payload was loaded. Run the checklist build script, then reload this page.', true);
      document.documentElement.dataset.viewerReady = 'true';
      return;
    }

    payload.categories.forEach(function (category) {
      var group = element('optgroup');
      group.label = category;
      payload.checklists.filter(function (entry) { return entry.category === category; }).forEach(function (entry) {
        var option = element('option', '', entry.checklist.title);
        option.value = entry.identity;
        group.append(option);
      });
      picker.append(group);
    });
    var selected = payload.checklists.find(function (entry) { return entry.identity === selectedIdentity; });
    if (selected) {
      picker.value = selected.identity;
      renderChecklist(selected);
    } else if (payload.checklists.length === 1) {
      picker.value = payload.checklists[0].identity;
      renderChecklist(payload.checklists[0]);
    } else {
      showMessage(payload.checklists.length ? 'Choose a checklist from the menu above.' : 'No checklist JSON files were found.');
    }
    document.documentElement.dataset.viewerReady = 'true';
  }

  function exportProgress() {
    if (!currentEntry) return setStatus('Choose a checklist before exporting progress.');
    var blob = new Blob([JSON.stringify(progressRecord(), null, 2) + '\n'], { type: 'application/json' });
    var anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = currentEntry.identity.replaceAll('/', '-') + '.progress.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setStatus('Progress export created.');
  }

  function importProgress(file) {
    if (!currentEntry || !file) return;
    var reader = new FileReader();
    reader.addEventListener('load', function () {
      try {
        var imported = JSON.parse(String(reader.result));
        if (imported.repositoryId !== payload.repositoryId || imported.checklistIdentity !== currentEntry.identity) {
          throw new Error('This progress file belongs to a different repository or checklist.');
        }
        if (imported.contentHash !== currentEntry.contentHash) throw new Error('This progress file is for different checklist content.');
        currentStates = normalizedStates(currentEntry, imported.states);
        saveProgress();
        renderChecklist(currentEntry, currentStates);
        setStatus('Progress imported.');
      } catch (error) {
        setStatus('Progress import failed: ' + error.message);
      }
    });
    reader.addEventListener('error', function () { setStatus('Progress import failed: the file could not be read.'); });
    reader.readAsText(file);
  }

  function refreshPayload() {
    if (refreshPending) return;
    refreshPending = true;
    var previousGeneratedAt = payload && payload.generatedAt;
    var selectedIdentity = currentEntry && currentEntry.identity;
    var script = document.createElement('script');
    script.src = './data.generated.js?' + Date.now();
    script.addEventListener('load', function () {
      refreshPending = false;
      var refreshed = window.BEARINGS_CHECKLISTS;
      if (refreshed && refreshed.generatedAt !== previousGeneratedAt) {
        payload = refreshed;
        renderLibrary(selectedIdentity);
        setStatus('Checklist library refreshed.');
      }
      script.remove();
    });
    script.addEventListener('error', function () {
      refreshPending = false;
      script.remove();
      setStatus('Could not refresh the generated checklist payload.');
    });
    document.head.append(script);
  }

  picker.addEventListener('change', function () {
    var selected = payload.checklists.find(function (entry) { return entry.identity === picker.value; });
    if (selected) renderChecklist(selected);
    else showMessage('Choose a checklist from the menu above.');
  });
  document.getElementById('export-progress').addEventListener('click', exportProgress);
  document.getElementById('import-progress').addEventListener('click', function () {
    if (!currentEntry) return setStatus('Choose a checklist before importing progress.');
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', function (event) {
    importProgress(event.target.files[0]);
    event.target.value = '';
  });
  document.getElementById('reset-progress').addEventListener('click', function () {
    if (!currentEntry || !window.confirm('Clear progress for this checklist?')) return;
    currentStates = {};
    saveProgress();
    renderChecklist(currentEntry);
    setStatus('Progress reset.');
  });
  window.addEventListener('focus', refreshPayload);

  renderLibrary('');
}());
