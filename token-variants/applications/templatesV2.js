import { CORE_TEMPLATES } from '../scripts/mappingTemplates.js';
import { TVA_CONFIG, updateSettings } from '../scripts/settings.js';
import { sortMappingsToGroups } from './effectMappingForm.js';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TemplatesV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._category = 'user';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'tva-templates',
    window: {
      title: 'Templates',
      resizable: true,
    },
    position: {
      width: 500,
      height: 'auto',
    },
    classes: ['template-gallery'],
    actions: {
      changeCategory: TemplatesV2._onChangeCategory,
      copyTemplate: TemplatesV2._onCopyTemplate,
      deleteTemplate: TemplatesV2._onDeleteTemplate,
    },
  };

  /** @override */
  static PARTS = {
    header: {
      template: `modules/token-variants/templates/mapping-templates/header.hbs`,
    },
    list: {
      template: `modules/token-variants/templates/mapping-templates/list.hbs`,
      scrollable: ['.list'],
    },
  };

  /** @override */
  async _preparePartContext(partId, context, options) {
    context.partId = partId;
    switch (partId) {
      case 'header':
        context.category = this._category;
        break;
      case 'list':
        await this._prepareListContext(context, options);
        break;
    }
    return context;
  }
  async _prepareListContext(context, options) {
    if (!this._category) this._category = TVA_CONFIG.templateMappings?.length ? 'user' : 'core';
    if (this._category === 'user') {
      this.templates = TVA_CONFIG.templateMappings;
    } else {
      this.templates = CORE_TEMPLATES;
    }

    const query = this._searchQuery?.trim().toLowerCase();
    if (query) {
      this.templates = this.templates.filter(
        (t) =>
          t.name?.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query) ||
          t.createdBy?.toLowerCase().includes(query),
      );
    }

    for (const template of this.templates) {
      template.hint = template.hint?.replace(/(\r\n|\n|\r)/gm, '<br>');
    }

    context.templates = this.templates.map((t) => {
      return { ...t, img: t.img || 'icons/containers/boxes/crate-reinforced-brown.webp' };
    });

    context.category = this._category;
    context.allowDelete = this._category === 'user';
    context.allowCopy = this._category === 'core';
  }

  /** @override */
  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    switch (partId) {
      case 'header':
        element.querySelector('input[type="search"]').addEventListener('input', this._onSearch.bind(this));
        break;
      case 'list':
        element.querySelectorAll('.template').forEach((el) => {
          el.addEventListener('dragstart', (event) => {
            const { id } = event.target.closest('.template').dataset;
            const dragData = { type: 'TVA Template', id, source: this._category };
            event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
          });
        });
        break;
    }
  }

  _onSearch(event) {
    clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(() => {
      this._searchQuery = event.target.value;
      this.render({ parts: ['list'] });
    }, 200);
  }

  static _onChangeCategory(event, target) {
    this._category = target.dataset.category;
    this.render({ parts: ['header', 'list'] });
  }

  static async _onCopyTemplate(event, target) {
    const { id } = target.closest('.template').dataset;
    const template = foundry.utils.deepClone(CORE_TEMPLATES.find((t) => t.id === id));
    if (!template) return;

    TVA_CONFIG.templateMappings.push(template);
    await updateSettings({
      templateMappings: TVA_CONFIG.templateMappings,
    });
    ui.notifications.info(`Template {${template.name}} copied to User templates.`);
  }

  static async _onDeleteTemplate(event, target) {
    const { id } = target.closest('.template').dataset;

    await updateSettings({
      templateMappings: TVA_CONFIG.templateMappings.filter((m) => m.id !== id),
    });
    this.render({ parts: ['list'] });
  }

  // _getHeaderButtons() {
  //   const buttons = super._getHeaderButtons();
  //   buttons.unshift({
  //     label: 'Upload Template',
  //     class: '.token-variants-submit-template',
  //     icon: 'fa-solid fa-cloud-arrow-up',
  //     onclick: () => {
  //       new TemplateSubmissionForm().render(true);
  //     },
  //   });
  //   return buttons;
  // }

  /**
   * @param {Event} event
   * @param {Object} formData
   */
  async _updateObject(event, formData) {}
}

export class MappingSelect extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    if (options.title1) foundry.utils.setProperty(options, 'window.title', options.title1);
    super(options);
    this._mappings = options.mappings;
    this._callback = options.callback;
    this._title2 = options.title2 ?? 'Select Mappings';
    this._submitLabel = options.submitLabel ?? 'Confirm';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'tva-mapping-select',
    tag: 'form',
    form: {
      handler: MappingSelect._onSubmit,
      closeOnSubmit: true,
    },
    window: {
      title: 'Templates',
      contentClasses: ['standard-form'],
      resizable: true,
    },
    position: {
      width: 400,
      height: 'auto',
    },
    actions: {
      selectAll: MappingSelect._onSelectAll,
    },
  };

  /** @override */
  static PARTS = {
    select: {
      template: `modules/token-variants/templates/mapping-templates/select.hbs`,
    },
    footer: { template: 'templates/generic/form-footer.hbs' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { groups } = sortMappingsToGroups(this._mappings);
    context.title2 = this._title2;
    context.groups = groups;
    context.buttons = [{ type: 'submit', icon: '', label: this._submitLabel, action: 'confirm' }];
    return context;
  }

  static _onSelectAll(event, target) {
    this.element.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      el.checked = true;
    });
  }

  static async _onSubmit(event, form, formData) {
    const selectedMappings = [];
    for (const [id, checked] of Object.entries(formData.object)) {
      if (!checked) continue;
      const mapping = this._mappings.find((m) => m.id === id);
      if (mapping) {
        const cMapping = foundry.utils.deepClone(mapping);
        selectedMappings.push(cMapping);
        delete cMapping.targetActors;
      }
    }

    this._callback?.(selectedMappings);
    this._callback = null;
  }

  async close(...args) {
    this._callback?.(null);
    return super.close(...args);
  }
}

export class CreateTemplate extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(mappings) {
    super({});
    this._mappings = mappings;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'tva-template-create',
    tag: 'form',
    form: {
      handler: CreateTemplate._onSubmit,
      closeOnSubmit: false,
    },
    window: {
      title: 'New Template',
      contentClasses: ['standard-form'],
      resizable: true,
    },
    position: {
      width: 400,
      height: 'auto',
    },
  };

  /** @override */
  static PARTS = {
    select: {
      template: `modules/token-variants/templates/mapping-templates/create.hbs`,
    },
    footer: { template: 'templates/generic/form-footer.hbs' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.buttons = [{ type: 'submit', icon: '', label: 'Create Template' }];
    return context;
  }

  static async _onSubmit(event, form, formData) {
    let { name, img, description } = formData.object;
    name = name.trim();
    img = img.trim();
    description = description.trim();

    if (name) {
      TVA_CONFIG.templateMappings.push({
        id: foundry.utils.randomID(),
        name,
        hint: description,
        img,
        mappings: foundry.utils.deepClone(this._mappings),
      });
      await updateSettings({ templateMappings: TVA_CONFIG.templateMappings });
      const templateApp = foundry.applications.instances.get(TemplatesV2.DEFAULT_OPTIONS.id);
      templateApp?.render(true);
      this.close();
    } else {
      ui.notifications.warn('Template name is required.');
    }
  }
}
