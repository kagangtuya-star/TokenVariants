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
      communityGallery: TemplatesV2._onCommunityGallery,
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
        element.addEventListener('drop', this._onDrop.bind(this));
        break;
    }
  }

  async _onDrop(event) {
    const { type, subtype, src } = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

    if (type === 'CommunityGalleryEntry' && subtype === 'TVA Template') {
      const response = await fetch(src);
      const entry = await response.json();
      const template = {
        id: foundry.utils.randomID(),
        name: entry.title,
        hint: entry.description,
        mappings: entry.data.mappings,
        img: 'https://assets.gallery.aedif.net' + entry.thumbnail,
        createdBy: entry.author,
        modules: entry.dependencies
          .filter((id) => id !== 'token-variants')
          .map((id) => {
            return { id };
          }),
        system: entry.system.dependency ? entry.system.id : '',
      };

      TVA_CONFIG.templateMappings.push(template);
      await updateSettings({ templateMappings: TVA_CONFIG.templateMappings });
      this.render(true);
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

  async _onCopyTemplate(target) {
    const { id } = target.closest('.template').dataset;
    const template = foundry.utils.deepClone(CORE_TEMPLATES.find((t) => t.id === id));
    if (!template) return;

    TVA_CONFIG.templateMappings.push(template);
    await updateSettings({
      templateMappings: TVA_CONFIG.templateMappings,
    });
    ui.notifications.info(`Template {${template.name}} copied to User templates.`);
  }

  async _onDeleteTemplate(target) {
    const { id } = target.closest('.template').dataset;

    await updateSettings({
      templateMappings: TVA_CONFIG.templateMappings.filter((m) => m.id !== id),
    });
    this.render({ parts: ['list'] });
  }

  static async _onCommunityGallery() {
    const { default: Gallery } = await import(
      /* webpackIgnore: true */ 'https://gallery.aedif.net/foundry-app/gallery.js'
    );
    Gallery.browse({ filter: '@"TVA Template"' });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._createContextMenu(this._getTemplateContextOptions, '.template', {
      hookName: 'getTVATemplateContextOptions',
    });
  }

  _getTemplateContextOptions() {
    return [
      {
        name: 'Upload To Gallery',
        icon: '<i class="fa-solid fa-cloud-arrow-up"></i>',
        condition: () => this._category === 'user',
        callback: (element) => this._onUploadTemplate(element),
      },
      {
        name: 'Copy To User',
        icon: '<i class="fas fa-clone"></i>',
        condition: () => this._category === 'core',
        callback: (element) => this._onCopyTemplate(element),
      },
      {
        name: 'Delete',
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: () => this._category === 'user',
        callback: (element) => this._onDeleteTemplate(element),
      },
    ];
  }

  async _onUploadTemplate(element) {
    if (this._category !== 'user') return;

    const id = element.dataset.id;
    const template = foundry.utils.deepClone(this.templates.find((t) => t.id === id));
    if (!template) return;

    const title = template.name ?? '';
    const description = template.hint ?? '';
    const author = template.createdBy ?? '';
    const dependencies = ['token-variants'];
    if (Array.isArray(template.modules)) template.modules.forEach((m) => dependencies.push(m.id));
    if (template.system?.trim()) dependencies.push(template.system.trim());

    const { mappings } = template;

    const { default: Gallery } = await import(
      /* webpackIgnore: true */ 'https://gallery.aedif.net/foundry-app/gallery.js'
    );

    Gallery.submit({
      title,
      author,
      description,
      tags: ['tva'],
      data: { mappings },
      dependencies,
      type: 'TVA Template',
    });
  }

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
      foundry.applications.instances.get(TemplatesV2.DEFAULT_OPTIONS.id)?.render(true);

      this.close();
    } else {
      ui.notifications.warn('Template name is required.');
    }
  }
}
