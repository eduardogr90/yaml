(function () {
  const body = document.body;
  const sidebar = document.getElementById('projects-panel');
  const hideButton = document.getElementById('btn-hide-projects');
  const toggleButton = document.getElementById('btn-toggle-projects');
  const projectTree = document.getElementById('project-tree');
  const projectSearchInput = document.getElementById('project-search-input');
  const createProjectForm = document.getElementById('create-project-form');
  const searchEmptyState = projectTree
    ? projectTree.querySelector('.project-tree__empty--search')
    : null;
  const CANCEL_ATTRIBUTE = 'data-action';
  const RENAME_VISIBLE_CLASS = 'is-visible';
  const RENAMING_CLASS = 'is-renaming';
  let editorBridge = window.APP_EDITOR || null;
  const pendingFlowNavigation = new WeakMap();

  function isSidebarCollapsed() {
    return body.classList.contains('projects-collapsed');
  }

  function escapeSelector(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function setSidebarCollapsed(collapsed) {
    body.classList.toggle('projects-collapsed', collapsed);
    if (sidebar) {
      sidebar.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    }
    if (hideButton) {
      hideButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      hideButton.textContent = collapsed ? 'Mostrar panel' : 'Ocultar panel';
    }
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleButton.textContent = collapsed ? 'Mostrar panel de proyectos' : 'Ocultar panel de proyectos';
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!isSidebarCollapsed());
  }

  if (hideButton) {
    hideButton.addEventListener('click', toggleSidebar);
  }
  if (toggleButton) {
    toggleButton.addEventListener('click', toggleSidebar);
  }
  setSidebarCollapsed(isSidebarCollapsed());

  function ensureActiveBranchOpen() {
    const activeProjectId = body.dataset.activeProject;
    if (!activeProjectId) {
      return;
    }
    const branch = document.querySelector(
      `.project-tree__project[data-project-id="${escapeSelector(activeProjectId)}"] details`
    );
    if (branch) {
      branch.open = true;
    }
  }

  ensureActiveBranchOpen();

  function normaliseSearchText(value) {
    return (value || '').toString().toLowerCase();
  }

  function matchesQuery(text, query) {
    if (!query) {
      return true;
    }
    return normaliseSearchText(text).includes(query);
  }

  function filterProjects(query) {
    if (!projectTree) {
      return;
    }
    const trimmedQuery = normaliseSearchText(query).trim();
    let visibleProjects = 0;
    const projectItems = projectTree.querySelectorAll('.project-tree__project');
    projectItems.forEach((projectItem) => {
      const projectText = projectItem.dataset.searchText || '';
      const details = projectItem.querySelector('details');
      const flows = projectItem.querySelectorAll('.project-flow');
      let visibleFlows = 0;
      flows.forEach((flowItem) => {
        const flowText = flowItem.dataset.searchText || '';
        const flowMatches = matchesQuery(flowText, trimmedQuery) || matchesQuery(projectText, trimmedQuery);
        if (trimmedQuery) {
          flowItem.hidden = !flowMatches;
        } else {
          flowItem.hidden = false;
        }
        if (!flowItem.hidden) {
          visibleFlows += 1;
        }
      });
      const projectMatches = matchesQuery(projectText, trimmedQuery);
      const shouldShow = projectMatches || visibleFlows > 0;
      projectItem.hidden = Boolean(trimmedQuery) && !shouldShow;
      if (!projectItem.hidden) {
        visibleProjects += 1;
      }
      if (details) {
        if (!trimmedQuery) {
          // keep original state; do nothing
        } else if (shouldShow) {
          details.open = true;
        }
      }
    });
    if (searchEmptyState) {
      const shouldHide = !projectTree || !trimmedQuery || visibleProjects > 0;
      searchEmptyState.hidden = shouldHide;
    }
  }

  if (projectSearchInput) {
    projectSearchInput.addEventListener('input', () => {
      filterProjects(projectSearchInput.value);
    });
    projectSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        projectSearchInput.value = '';
        filterProjects('');
      }
    });
  }

  if (createProjectForm) {
    createProjectForm.addEventListener('submit', (event) => {
      const nameField = projectSearchInput;
      if (!nameField) {
        return;
      }
      const trimmed = nameField.value.trim();
      if (!trimmed) {
        event.preventDefault();
        filterProjects('');
        return;
      }
      nameField.value = trimmed;
    });
  }

  filterProjects(projectSearchInput ? projectSearchInput.value : '');

  function getRenameContainer(element) {
    if (!element) {
      return null;
    }
    return (
      element.closest('.project-flow') || element.closest('.project-tree__project') || element.parentElement
    );
  }

  function cancelScheduledNavigation(trigger) {
    const button = trigger ? trigger.closest('.project-flow__select') : null;
    if (button && pendingFlowNavigation.has(button)) {
      const timer = pendingFlowNavigation.get(button);
      window.clearTimeout(timer);
      pendingFlowNavigation.delete(button);
    }
  }

  function showRenameForm(formId, trigger) {
    const form = document.getElementById(formId);
    if (!form) {
      return;
    }
    cancelScheduledNavigation(trigger);
    const container = getRenameContainer(form);
    if (container && container.classList) {
      container.classList.add(RENAMING_CLASS);
    }
    form.classList.add(RENAME_VISIBLE_CLASS);
    const firstField = form.querySelector('input, textarea');
    if (firstField) {
      window.requestAnimationFrame(() => {
        firstField.focus();
        if (firstField.select) {
          firstField.select();
        }
      });
    }
    if (trigger) {
      const parentDetails = trigger.closest('details');
      if (parentDetails) {
        parentDetails.open = true;
      }
    }
  }

  function hideRenameForm(form) {
    if (!form) {
      return;
    }
    form.classList.remove(RENAME_VISIBLE_CLASS);
    const container = getRenameContainer(form);
    if (container && container.classList) {
      container.classList.remove(RENAMING_CLASS);
    }
  }

  document.querySelectorAll('.editable-label').forEach((label) => {
    const formId = label.getAttribute('data-rename-form');
    if (!formId) {
      return;
    }
    label.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelScheduledNavigation(label);
      showRenameForm(formId, label);
    });
  });

  document.querySelectorAll('.rename-form').forEach((form) => {
    const cancelButton = form.querySelector(`[${CANCEL_ATTRIBUTE}="cancel-rename"]`);
    if (cancelButton) {
      cancelButton.addEventListener('click', (event) => {
        event.preventDefault();
        hideRenameForm(form);
      });
    }
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideRenameForm(form);
      }
    });
    form.addEventListener('submit', () => {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.setAttribute('disabled', 'disabled');
      }
    });
  });

  document.querySelectorAll('.create-flow-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const form = button.closest('form');
      if (!form) {
        return;
      }
      const nameField = form.querySelector('input[name="flow_name"]');
      const descriptionField = form.querySelector('input[name="flow_description"]');
      const response = window.prompt('Nombre del nuevo flujo', '');
      if (response === null) {
        return;
      }
      const trimmed = response.trim();
      if (nameField) {
        nameField.value = trimmed || 'Nuevo flujo';
      }
      if (descriptionField) {
        descriptionField.value = '';
      }
      form.submit();
    });
  });

  function isEditorDirty() {
    return Boolean(editorBridge && typeof editorBridge.isDirty === 'function' && editorBridge.isDirty());
  }

  function guardAgainstDirtyNavigation(event) {
    if (!isEditorDirty()) {
      return;
    }
    const confirmed = window.confirm('Tienes cambios sin guardar. ¿Deseas descartarlos?');
    if (!confirmed) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function scheduleFlowNavigation(button) {
    if (!button) {
      return;
    }
    const href = button.dataset.href;
    if (!href) {
      return;
    }
    const timer = window.setTimeout(() => {
      pendingFlowNavigation.delete(button);
      window.location.href = href;
    }, 250);
    pendingFlowNavigation.set(button, timer);
  }

  document.querySelectorAll('.project-flow__select').forEach((button) => {
    button.addEventListener('click', (event) => {
      cancelScheduledNavigation(button);
      guardAgainstDirtyNavigation(event);
      if (event.defaultPrevented) {
        return;
      }
      scheduleFlowNavigation(button);
    });
  });

  document.querySelectorAll('[data-ensure-clean="true"]').forEach((element) => {
    if (element.classList && element.classList.contains('project-flow__select')) {
      return;
    }
    element.addEventListener('click', guardAgainstDirtyNavigation);
  });

  const cancelButton = document.getElementById('btn-cancel-edit');
  if (cancelButton) {
    cancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      if (isEditorDirty()) {
        const confirmed = window.confirm('¿Descartar los cambios sin guardar?');
        if (!confirmed) {
          return;
        }
      }
      const target = cancelButton.getAttribute('data-href') || '/';
      window.location.href = target;
    });
  }

  function handleEditorReady(event) {
    const detailEditor = event.detail && event.detail.editor;
    editorBridge = detailEditor || window.APP_EDITOR || editorBridge;
  }

  window.addEventListener('app-editor:init', handleEditorReady);
})();
