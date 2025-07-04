import { toggleTemplateOnSelected } from '../scripts/hooks/effectMappingHooks.js';
import { TVA_CONFIG, updateSettings } from '../scripts/settings.js';
import { BASE_IMAGE_CATEGORIES, uploadTokenImage } from '../scripts/utils.js';
import { sortMappingsToGroups } from './effectMappingForm.js';
import { Templates } from './templates.js';
import TokenCustomConfig from './tokenCustomConfig.js';

// Edit overlay configuration as a json string
export function showOverlayJsonConfigDialog(overlayConfig, callback) {
  const config = foundry.utils.deepClone(overlayConfig || {});
  delete config.effect;
  let content = `<div style="height: 300px;" class="form-group stacked command"><textarea style="height: 300px;" class="configJson">${JSON.stringify(
    config,
    null,
    2
  )}</textarea></div>`;

  new Dialog({
    title: `Overlay Configuration`,
    content: content,
    buttons: {
      yes: {
        icon: "<i class='fas fa-save'></i>",
        label: 'Save',
        callback: (html) => {
          let json = $(html).find('.configJson').val();
          if (json) {
            try {
              json = JSON.parse(json);
            } catch (e) {
              console.warn(`TVA |`, e);
              json = {};
            }
          } else {
            json = {};
          }
          callback(json);
        },
      },
    },
    default: 'yes',
  }).render(true);
}

// Change categories assigned to a path
export async function showPathSelectCategoryDialog(event) {
  event.preventDefault();
  const typesInput = $(event.target).closest('.path-category').find('input');
  const selectedTypes = typesInput.val().split(',');

  const categories = BASE_IMAGE_CATEGORIES.concat(TVA_CONFIG.customImageCategories);

  let content = '<div class="token-variants-popup-settings">';

  // Split into rows of 4
  const splits = [];
  let currSplit = [];
  for (let i = 0; i < categories.length; i++) {
    if (i > 0 && i + 1 != categories.length && i % 4 == 0) {
      splits.push(currSplit);
      currSplit = [];
    }
    currSplit.push(categories[i]);
  }
  if (currSplit.length) splits.push(currSplit);

  for (const split of splits) {
    content += '<header class="table-header flexrow">';
    for (const type of split) {
      content += `<label>${type}</label>`;
    }
    content += '</header><ul class="setting-list"><li class="setting form-group"><div class="form-fields">';
    for (const type of split) {
      content += `<input class="category" type="checkbox" name="${type}" data-dtype="Boolean" ${
        selectedTypes.includes(type) ? 'checked' : ''
      }>`;
    }
    content += '</div></li></ul>';
  }
  content += '</div>';

  new Dialog({
    title: `Image Categories/Filters`,
    content: content,
    buttons: {
      yes: {
        icon: "<i class='fas fa-save'></i>",
        label: 'Apply',
        callback: (html) => {
          const types = [];
          $(html)
            .find('.category')
            .each(function () {
              if ($(this).is(':checked')) {
                types.push($(this).attr('name'));
              }
            });
          typesInput.val(types.join(','));
        },
      },
    },
    default: 'yes',
  }).render(true);
}

// Change configs assigned to a path
export async function showPathSelectConfigForm(event) {
  event.preventDefault();
  const configInput = $(event.target).closest('.path-config').find('input');
  let config = {};
  try {
    config = JSON.parse(configInput.val());
  } catch (e) {}

  const token = new TokenDocument();
  new TokenCustomConfig(
    token,
    {},
    null,
    null,
    (conf) => {
      if (!conf) conf = {};
      if (conf.flags == null || foundry.utils.isEmpty(conf.flags)) delete conf.flags;
      configInput.val(JSON.stringify(conf));
      const cog = configInput.siblings('.select-config');
      if (foundry.utils.isEmpty(conf)) cog.removeClass('active');
      else cog.addClass('active');
    },
    config
  ).render(true);
}

export async function showTokenCaptureDialog(token) {
  if (!token) return;
  let content = `<form>
<div class="form-group">
  <label>Image Name</label>
  <input type="text" name="name" value="${token.name}">
</div>
<div class="form-group">
  <label>Image Path</label>
    <div class="form-fields">
      <input type="text" name="path" value="modules/token-variants/">
      <button type="button" class="file-picker" data-type="folder" data-target="path" title="Browse Folders" tabindex="-1">
        <i class="fas fa-file-import fa-fw"></i>
      </button>
    </div>
</div>
<div class="form-group slim">
  <label>Width <span class="units">(pixels)</span></label>
  <div class="form-fields">
      <input type="number" step="1" name="width" value="${token.mesh.texture.width}">
  </div>
</div>
<div class="form-group slim">
  <label>Height <span class="units">(pixels)</span></label>
  <div class="form-fields">
      <input type="number" step="1" name="height" value="${token.mesh.texture.height}">
  </div>
</div>
<div class="form-group slim">
  <label>Scale</label>
  <div class="form-fields">
    <input type="number" step="any" name="scale" value="3">
  </div>
</div>
</form>`;

  new Dialog({
    title: `Save Token/Overlay Image`,
    content: content,
    buttons: {
      yes: {
        icon: "<i class='fas fa-save'></i>",
        label: 'Save',
        callback: (html) => {
          const options = {};
          $(html)
            .find('[name]')
            .each(function () {
              let val = parseFloat(this.value);
              if (isNaN(val)) val = this.value;
              options[this.name] = val;
            });
          uploadTokenImage(token, options);
        },
      },
    },
    render: (html) => {
      html.find('.file-picker').click(() => {
        new foundry.applications.apps.FilePicker.implementation({
          type: 'folder',
          current: html.find('[name="path"]').val(),
          callback: (path) => {
            html.find('[name="path"]').val(path);
          },
        }).render();
      });
    },
    default: 'yes',
  }).render(true);
}

export function showMappingSelectDialog(
  mappings,
  { title1 = 'Mappings', title2 = 'Select Mappings', buttonTitle = 'Confirm', callback = null } = {}
) {
  if (!mappings || !mappings.length) return;

  let content = `<form style="overflow-y: scroll; height:400px;"><h2>${title2}</h2>`;

  const [_, mappingGroups] = sortMappingsToGroups(mappings);
  for (const [group, obj] of Object.entries(mappingGroups)) {
    if (obj.list.length) {
      content += `<h4 style="text-align:center;"><b>${group}</b></h4>`;
      for (const mapping of obj.list) {
        content += `
        <div class="form-group">
          <label>${mapping.label}</label>
          <div class="form-fields">
              <input type="checkbox" name="${mapping.id}" data-dtype="Boolean">
          </div>
        </div>
        `;
      }
    }
  }

  content += `</form><div class="form-group"><button type="button" class="select-all">Select all</div>`;

  new Dialog({
    title: title1,
    content: content,
    buttons: {
      Ok: {
        label: buttonTitle,
        callback: async (html) => {
          if (!callback) return;
          const selectedMappings = [];
          html.find('input[type="checkbox"]').each(function () {
            if (this.checked) {
              const mapping = mappings.find((m) => m.id === this.name);
              if (mapping) {
                const cMapping = foundry.utils.deepClone(mapping);
                selectedMappings.push(cMapping);
                delete cMapping.targetActors;
              }
            }
          });
          callback(selectedMappings);
        },
      },
    },
    close: () => callback(null),
    render: (html) => {
      html.find('.select-all').click(() => {
        html.find('input[type="checkbox"]').prop('checked', true);
      });
    },
  }).render(true);
}

export function showUserTemplateCreateDialog(mappings) {
  let content = `
<div class="form-group">
  <label>Template Name</label>
  <div class="form-fields">
    <input type="text" name="templateName" data-dtype="String" value="">
  </div>
</div>
<div class="form-group">
  <label>Hover Text (optional)</label>
  <div class="form-fields">
    <input type="text" name="templateHint" data-dtype="String" value="">
  </div>
</div>
<div class="form-group">
  <label>Hover Image (optional)</label>
  <div class="form-fields">
    <input type="text" name="img" data-dtype="String" value="">
  </div>
</div>`;

  let dialog;
  dialog = new Dialog({
    title: 'Mapping Templates',
    content,
    buttons: {
      create: {
        label: 'Create Template',
        callback: (html) => {
          const name = html.find('[name="templateName"]').val().trim();
          const hint = html.find('[name="templateHint"]').val().trim();
          const img = html.find('[name="img"]').val().trim();
          if (name.trim()) {
            TVA_CONFIG.templateMappings.push({
              id: foundry.utils.randomID(),
              name,
              hint,
              img,
              mappings: foundry.utils.deepClone(mappings),
            });
            updateSettings({ templateMappings: TVA_CONFIG.templateMappings });
          }
        },
      },
      cancel: {
        label: 'Cancel',
      },
    },
    default: 'cancel',
  });
  dialog.render(true);
}

export function toggleTemplateDialog() {
  new Templates({ callback: (templateName, mappings) => toggleTemplateOnSelected(templateName, mappings) }).render(
    true
  );
}
