import { FILTERS } from '../../applications/overlayConfig.js';
import { evaluateComparator, getTokenEffects } from '../hooks/effectMappingHooks.js';
import { registerOverlayRefreshHook, unregisterOverlayRefreshHooks } from '../hooks/overlayHooks.js';
import { DEFAULT_OVERLAY_CONFIG } from '../models.js';
import { interpolateColor, removeMarkedOverlays } from '../token/overlay.js';
import { executeMacro, toggleCEEffect, toggleTMFXPreset, tv_executeScript } from '../utils.js';
import { HTMLOverlay } from './HTMLOverlay.js';

export class TVAOverlay extends foundry.canvas.primary.PrimarySpriteMesh {
  constructor(pTexture, token, config) {
    super({ name: 'TVAOverlay', object: token });
    if (pTexture.shapes) pTexture.shapes = this.addChild(pTexture.shapes);

    this.pseudoTexture = pTexture;
    this.texture = pTexture.texture;
    //this.setTexture(pTexture, { refresh: false });
    this.occludedAlpha = 1; // Prevent overlay from fading when occluded

    this.ready = false;
    this.overlaySort = 0;
    this.filtersApplied = false;

    this.overlayConfig = foundry.utils.mergeObject(DEFAULT_OVERLAY_CONFIG, config, { inplace: false });
    if (pTexture.html) this.addHTMLOverlay();

    // linkDimensions has been converted to linkDimensionsX and linkDimensionsY
    // Make sure we're using the latest fields
    // 20/07/2023
    if (!('linkDimensionsX' in this.overlayConfig) && this.overlayConfig.linkDimensions) {
      this.overlayConfig.linkDimensionsX = true;
      this.overlayConfig.linkDimensionsY = true;
    }

    this._registerHooks(this.overlayConfig);
    this._tvaPlay().then(() => this.refresh());

    // Workaround needed for v12 visible property
    Object.defineProperty(this, 'visible', {
      get: this._customVisible,
      set: function () {},
      configurable: true,
    });

    this.eventMode = 'none';
  }

  enableInteractivity() {
    if (this.mouseInteractionManager && !this.overlayConfig.interactivity?.length) {
      this.removeAllListeners();
      this.mouseInteractionManager = null;
      this.cursor = null;
      this.eventMode = 'none';
      return;
    } else if (this.mouseInteractionManager || !this.overlayConfig.interactivity?.length) return;

    if (!this.overlayConfig.ui) {
      if (canvas.primary.eventMode === 'passive') {
        canvas.primary.eventMode = 'passive';
      }
    }

    this.eventMode = 'static';

    // If this overlay iss interactable all of its parents need to be set as interactable too
    let parent = this.parent;
    while (parent instanceof TVAOverlay || parent?.parent instanceof TVAOverlay) {
      parent.eventMode = 'passive';
      parent = parent.parent;
    }

    this.cursor = 'pointer';
    const token = this.object;
    const sprite = this;

    const runInteraction = function (event, listener) {
      sprite.overlayConfig.interactivity.forEach((i) => {
        if (i.listener === listener) {
          event.preventDefault();
          event.stopPropagation();
          if (i.script) tv_executeScript(i.script, { token });
          if (i.macro) executeMacro(i.macro, token);
          if (i.ceEffect) toggleCEEffect(token, i.ceEffect);
          if (i.tmfxPreset) toggleTMFXPreset(token, i.tmfxPreset);
        }
      });
    };

    const permissions = {
      hoverIn: () => true,
      hoverOut: () => true,
      clickLeft: () => true,
      clickLeft2: () => true,
      clickRight: () => true,
      clickRight2: () => true,
      dragStart: () => false,
    };

    const callbacks = {
      hoverIn: (event) => runInteraction(event, 'hoverIn'),
      hoverOut: (event) => runInteraction(event, 'hoverOut'),
      clickLeft: (event) => runInteraction(event, 'clickLeft'),
      clickLeft2: (event) => runInteraction(event, 'clickLeft2'),
      clickRight: (event) => runInteraction(event, 'clickRight'),
      clickRight2: (event) => runInteraction(event, 'clickRight2'),
      dragLeftStart: null,
      dragLeftMove: null,
      dragLeftDrop: null,
      dragLeftCancel: null,
      dragRightStart: null,
      dragRightMove: null,
      dragRightDrop: null,
      dragRightCancel: null,
      longPress: null,
    };

    const options = { target: null };

    // Create the interaction manager
    const mgr = new MouseInteractionManager(this, canvas.stage, permissions, callbacks, options);
    this.mouseInteractionManager = mgr.activate();
  }

  /**
   * Override
   */
  _onAdded() {
    // do nothing
    // foundry throws inconsequential errors within this method
  }

  _customVisible() {
    const ov = this.overlayConfig;
    if (!this.ready || !(this.object.visible || ov.alwaysVisible)) return false;

    if (ov.limitedToOwner && !this.object.isOwner) return false;
    if (ov.limitedUsers?.length && !ov.limitedUsers.includes(game.user.id)) return false;

    if (ov.limitOnEffect || ov.limitOnProperty) {
      const speaker = ChatMessage.getSpeaker();
      let token = canvas.ready ? canvas.tokens.get(speaker.token) : null;
      if (!token) return false;
      if (ov.limitOnEffect) {
        if (!getTokenEffects(token).includes(ov.limitOnEffect)) return false;
      }
      if (ov.limitOnProperty) {
        if (!evaluateComparator(token.document, ov.limitOnProperty)) return false;
      }
    }

    if (this.object.detectionLevel === 1) return Boolean(ov.impreciseVisible);

    if (
      ov.limitOnHover ||
      ov.limitOnControl ||
      ov.limitOnHighlight ||
      ov.limitOnHUD ||
      ov.limitOnTarget ||
      ov.limitOnAnyTarget
    ) {
      if (ov.limitOnHover && canvas.controls.ruler._state === Ruler.STATES.INACTIVE && this.object.hover) return true;
      if (ov.limitOnControl && this.object.controlled) return true;
      if (ov.limitOnHighlight && (canvas.tokens.highlightObjects ?? canvas.tokens._highlight)) return true;
      if (ov.limitOnHUD && this.object.hasActiveHUD) return true;
      if (ov.limitOnAnyTarget && this.object.targeted.size) return true;
      if (ov.limitOnTarget && this.object.targeted.some((u) => u.id === game.userId)) return true;
      return false;
    }
    return true;
  }

  get sortLayer() {
    return this.object.mesh?.sortLayer || 0;
  }

  get zIndex() {
    let zIndex = this.object.mesh.zIndex;
    if (this.overlayConfig.ui && this.overlayConfig.bottom) zIndex -= 9999;
    return zIndex;
  }

  // Overlays have the same sort order as the parent
  get sort() {
    const sort = this.object.mesh.sort;
    if (this.overlayConfig.top) return sort + 9999;
    else if (this.overlayConfig.bottom) return sort - 9999;
    return sort;
  }

  get _lastSortedIndex() {
    return (this.object.mesh._lastSortedIndex || 0) + this.overlaySort;
  }

  get elevation() {
    const elevation = this.object.mesh?.elevation;
    if (this.overlayConfig.bottom && elevation > 0) return 0;
    else if (this.overlayConfig.top) return elevation + 9999;
    return elevation;
  }

  set _lastSortedIndex(val) {}

  async _tvaPlay() {
    // Ensure playback state for video
    const source = this.texture?.baseTexture?.resource?.source;
    if (source?.tagName === 'VIDEO') {
      // Detach video from others
      const s = source.cloneNode(true);
      if (this.overlayConfig.playOnce) {
        s.onended = () => {
          this.alpha = 0;
          this.tvaVideoEnded = true;
        };
      }

      await new Promise((resolve) => (s.oncanplay = resolve));
      this.texture = PIXI.Texture.from(s, { resourceOptions: { autoPlay: false } });

      const options = {
        loop: this.overlayConfig.loop && !this.overlayConfig.playOnce,
        volume: 0,
        offset: 0,
        playing: true,
      };
      game.video.play(s, options);
    }
  }

  addChildAuto(...children) {
    if (this.pseudoTexture?.shapes) {
      return this.pseudoTexture.shapes.addChild(...children);
    } else {
      return this.addChild(...children);
    }
  }

  setTexture(pTexture, { preview = false, refresh = true, configuration = null, refreshFilters = false } = {}) {
    // Text preview handling
    if (preview) {
      this._swapChildren(pTexture);
      if (this.originalTexture) this._destroyTexture();
      else {
        this.originalTexture = this.pseudoTexture;
        if (this.originalTexture.shapes) this.removeChild(this.originalTexture.shapes);
      }
      this.pseudoTexture = pTexture;
      this.texture = pTexture.texture;
      if (pTexture.shapes) pTexture.shapes = this.addChild(pTexture.shapes);
    } else if (this.originalTexture) {
      this._swapChildren(this.originalTexture);
      this._destroyTexture();
      this.pseudoTexture = this.originalTexture;
      this.texture = this.originalTexture.texture;
      if (this.originalTexture.shapes) this.pseudoTexture.shapes = this.addChild(this.originalTexture.shapes);
      delete this.originalTexture;
    } else {
      this._swapChildren(pTexture);
      this._destroyTexture();
      this.pseudoTexture = pTexture;
      this.texture = pTexture.texture;
      if (pTexture.shapes) this.pseudoTexture.shapes = this.addChild(pTexture.shapes);
    }

    if (this.pseudoTexture.html) this.addHTMLOverlay();
    if (refresh) this.refresh(configuration, { fullRefresh: !preview, refreshFilters });
  }

  refresh(configuration, { preview = false, fullRefresh = true, previewTexture = null, refreshFilters = false } = {}) {
    if (!this.overlayConfig || !this.texture) return;

    // Text preview handling
    if (previewTexture || this.originalTexture) {
      this.setTexture(previewTexture, { preview: Boolean(previewTexture), refresh: false });
    }

    // Register/Unregister hooks that should refresh this overlay
    if (configuration) {
      this._registerHooks(configuration);
    }

    const config = foundry.utils.mergeObject(this.overlayConfig, configuration ?? {}, { inplace: !preview });

    if (preview && this.htmlOverlay) this.htmlOverlay.render(config, true);

    this.enableInteractivity(config);

    if (fullRefresh) {
      const source = foundry.utils.getProperty(this.texture, 'baseTexture.resource.source');
      if (source && source.tagName === 'VIDEO') {
        if (!source.loop && config.loop) {
          game.video.play(source);
        } else if (source.loop && !config.loop) {
          game.video.stop(source);
        }
        source.loop = config.loop;
      }
    }

    const shapes = this.pseudoTexture.shapes;

    // Scale the image using the same logic as the token
    const dimensions = shapes ?? this.texture;
    if (config.linkScale && !config.parentID) {
      const scale = this.scale;
      const aspect = dimensions.width / dimensions.height;
      if (aspect >= 1) {
        scale.x = (this.object.w * Math.abs(this.object.document.texture.scaleX)) / dimensions.width;
        scale.y = Number(scale.x);
      } else {
        scale.y = (this.object.h * Math.abs(this.object.document.texture.scaleY)) / dimensions.height;
        scale.x = Number(scale.y);
      }
    } else if (config.linkStageScale) {
      this.scale.x = 1 / canvas.stage.scale.x;
      this.scale.y = 1 / canvas.stage.scale.y;
    } else if (config.linkDimensionsX || config.linkDimensionsY) {
      if (config.linkDimensionsX) {
        this.scale.x = this.object.document.width;
      }
      if (config.linkDimensionsY) {
        this.scale.y = this.object.document.height;
      }
    } else {
      this.scale.x = config.width ? config.width / dimensions.width : 1;
      this.scale.y = config.height ? config.height / dimensions.height : 1;
    }

    // Adjust scale according to config
    this.scale.x = this.scale.x * config.scaleX;
    this.scale.y = this.scale.y * config.scaleY;

    // Check if mirroring should be inherited from the token and if so apply it
    if (config.linkMirror && !config.parentID) {
      this.scale.x = Math.abs(this.scale.x) * (this.object.document.texture.scaleX < 0 ? -1 : 1);
      this.scale.y = Math.abs(this.scale.y) * (this.object.document.texture.scaleY < 0 ? -1 : 1);
    }

    if (this.anchor) {
      if (!config.anchor) this.anchor.set(0.5, 0.5);
      else this.anchor.set(config.anchor.x, config.anchor.y);
    }

    let xOff = 0;
    let yOff = 0;
    if (shapes) {
      shapes.position.x = -this.anchor.x * shapes.width;
      shapes.position.y = -this.anchor.y * shapes.height;
      if (config.animation.relative) {
        this.pivot.set(0, 0);
        shapes.pivot.set((0.5 - this.anchor.x) * shapes.width, (0.5 - this.anchor.y) * shapes.height);
        xOff = shapes.pivot.x * this.scale.x;
        yOff = shapes.pivot.y * this.scale.y;
      }
    } else if (config.animation.relative) {
      xOff = (0.5 - this.anchor.x) * this.width;
      yOff = (0.5 - this.anchor.y) * this.height;
      this.pivot.set((0.5 - this.anchor.x) * this.texture.width, (0.5 - this.anchor.y) * this.texture.height);
    }

    // Position
    const pOffsetX = config.pOffsetX || 0;
    const pOffsetY = config.pOffsetY || 0;
    if (config.parentID) {
      const anchor = this.parent.anchor ?? { x: 0, y: 0 };
      const pWidth = (this.parent.shapesWidth ?? this.parent.width) / this.parent.scale.x;
      const pHeight = (this.parent.shapesHeight ?? this.parent.height) / this.parent.scale.y;
      this.position.set(
        pOffsetX + -config.offsetX * pWidth - anchor.x * pWidth + pWidth / 2,
        pOffsetY + -config.offsetY * pHeight - anchor.y * pHeight + pHeight / 2
      );
    } else {
      if (config.animation.relative) {
        this.position.set(
          this.object.document.x + this.object.w / 2 + pOffsetX + -config.offsetX * this.object.w + xOff,
          this.object.document.y + this.object.h / 2 + pOffsetY + -config.offsetY * this.object.h + yOff
        );
      } else {
        this.position.set(this.object.document.x + this.object.w / 2, this.object.document.y + this.object.h / 2);
        this.pivot.set(
          -pOffsetX / this.scale.x + (config.offsetX * this.object.w) / this.scale.x,
          -pOffsetY / this.scale.y + (config.offsetY * this.object.h) / this.scale.y
        );
      }
    }

    // Set alpha but only if playOnce is disabled and the video hasn't
    // finished playing yet. Otherwise we want to keep alpha as 0 to keep the video hidden
    if (!this.tvaVideoEnded) {
      this.alpha = config.linkOpacity ? this.object.document.alpha : config.alpha;
    }

    // Angle in degrees
    if (fullRefresh) {
      if (config.linkRotation) this.angle = this.object.document.rotation + config.angle;
      else this.angle = config.angle;
    } else if (!config.animation.rotate) {
      if (config.linkRotation) this.angle = this.object.document.rotation + config.angle;
    }

    // Apply color tinting
    const tint = config.inheritTint
      ? this.object.document.texture.tint
      : interpolateColor(config.tint, config.interpolateColor, true);
    this.tint = tint ? Color.from(tint) : 0xffffff;
    if (shapes) {
      shapes.tint = this.tint;
      shapes.alpha = this.alpha;
    }

    if (fullRefresh) {
      if (config.animation.rotate) {
        this.animate(config);
      } else {
        this.stopAnimation();
      }
    }

    // Apply filters
    if (fullRefresh && (refreshFilters || !this.filtersApplied)) this._applyFilters(config);
    //if (fullRefresh) this.filters = this._getFilters(config);

    if (preview && this.children) {
      this.children.forEach((ch) => {
        if (ch instanceof TVAOverlay) ch.refresh(null, { preview: true });
      });
    }

    if (this.htmlOverlay) {
      this.htmlOverlay.setPosition({
        left: this.x - this.pivot.x * this.scale.x - this.width * this.anchor.x,
        top: this.y - this.pivot.y * this.scale.y - this.height * this.anchor.y,
        width: this.width,
        height: this.height,
        angle: this.angle,
      });
    }

    this.ready = true;
  }

  _activateTicker() {
    this._deactivateTicker();
    canvas.app.ticker.add(this.updatePosition, this, PIXI.UPDATE_PRIORITY.HIGH);
  }

  _deactivateTicker() {
    canvas.app.ticker.remove(this.updatePosition, this);
  }

  updatePosition() {
    let coord = canvas.canvasCoordinatesFromClient({
      x: window.innerWidth / 2 + this.overlayConfig.offsetX * window.innerWidth,
      y: window.innerHeight / 2 + this.overlayConfig.offsetY * window.innerHeight,
    });
    this.position.set(coord.x, coord.y);
  }

  async _applyFilters(config) {
    this.filtersApplied = true;
    const filterName = config.filter;
    const FilterClass = PIXI.filters[filterName];
    const options = foundry.utils.mergeObject(FILTERS[filterName]?.defaultValues || {}, config.filterOptions);
    let filter;
    if (FilterClass) {
      if (FILTERS[filterName]?.argType === 'args') {
        let args = [];
        const controls = FILTERS[filterName]?.controls;
        if (controls) {
          controls.forEach((c) => args.push(options[c.name]));
        }
        filter = new FilterClass(...args);
      } else if (FILTERS[filterName]?.argType === 'options') {
        filter = new FilterClass(options);
      } else {
        filter = new FilterClass();
      }
    } else if (filterName === 'OutlineOverlayFilter') {
      filter = OutlineFilter.create(options);
      filter.thickness = options.trueThickness ?? 1;
      filter.animated = options.animate ?? false;
    } else if (filterName === 'Token Magic FX') {
      this.applyTVAFilters(await constructTMFXFilters(options.params || [], this));
      return;
    }

    if (filter) {
      this.applyTVAFilters([filter]);
      this.filters = [filter];
    } else {
      this.removeTVAFilters();
    }
  }

  applyTVAFilters(filters) {
    if (filters?.length) {
      this.removeTVAFilters();
      this.filters = (this.filters || []).concat(filters);
    }
  }

  removeTVAFilters() {
    if (this.filters) this.filters = this.filters.filter((f) => !f.tvaFilter);
  }

  async stopAnimation() {
    if (this.animationName) {
      CanvasAnimation.terminateAnimation(this.animationName);
    }
  }

  async animate(config) {
    if (!this.animationName) this.animationName = this.object.sourceId + '.' + foundry.utils.randomID(5);

    let newAngle = this.angle + (config.animation.clockwise ? 360 : -360);
    const rotate = [{ parent: this, attribute: 'angle', to: newAngle }];

    const completed = await CanvasAnimation.animate(rotate, {
      duration: config.animation.duration,
      name: this.animationName,
    });
    if (completed) {
      this.animate(config);
    }
  }

  _registerHooks(configuration) {
    if (configuration.linkStageScale) registerOverlayRefreshHook(this, 'canvasPan');
    else unregisterOverlayRefreshHooks(this, 'canvasPan');
  }

  _swapChildren(to) {
    const from = this.pseudoTexture;
    if (from.shapes) {
      this.removeChild(this.pseudoTexture.shapes);
      const children = from.shapes.removeChildren();
      if (to?.shapes) children.forEach((c) => to.shapes.addChild(c)?.refresh());
      else children.forEach((c) => this.addChild(c)?.refresh());
    } else if (to?.shapes) {
      const children = this.removeChildren();
      children.forEach((c) => to.shapes.addChild(c)?.refresh());
    }
  }

  _destroyTexture() {
    if (this.texture.textLabel || this.texture.destroyable) {
      this.texture.destroy(true);
    }

    if (this.pseudoTexture?.shapes) {
      this.removeChild(this.pseudoTexture.shapes);
      this.pseudoTexture.shapes.destroy();
    } else if (this.pseudoTexture?.html) {
      this.removeHTMLOverlay();
    }
  }

  destroy() {
    this.stopAnimation();
    unregisterOverlayRefreshHooks(this);

    if (this.children) {
      for (const ch of this.children) {
        if (ch instanceof TVAOverlay) ch.tvaRemove = true;
      }
      removeMarkedOverlays(this.object);
      if (this.pseudoTexture.shapes) {
        this.pseudoTexture.shapes.children.forEach((c) => c.destroy());
        this.removeChild(this.pseudoTexture.shapes)?.destroy();
        //  this.pseudoTexture.shapes.destroy();
      }
    }

    if (this.texture.textLabel || this.texture.destroyable) {
      return super.destroy(true);
    } else if (this.texture?.baseTexture.resource?.source?.tagName === 'VIDEO') {
      this.texture.baseTexture.destroy();
    }

    this.removeHTMLOverlay();

    super.destroy();
  }

  // Foundry BUG Fix
  calculateTrimmedVertices() {
    return PIXI.Sprite.prototype.calculateTrimmedVertices.call(this);
  }

  addHTMLOverlay() {
    if (!this.htmlOverlay) this.htmlOverlay = new HTMLOverlay(this.overlayConfig, this.object);
  }

  removeHTMLOverlay() {
    if (this.htmlOverlay) this.htmlOverlay.remove();
    this.htmlOverlay = null;
  }
}

async function constructTMFXFilters(paramsArray, sprite) {
  if (typeof TokenMagic === 'undefined' || !('filterTypes' in TokenMagic)) return [];

  try {
    paramsArray = eval(paramsArray);
  } catch (e) {
    return [];
  }

  if (!Array.isArray(paramsArray)) {
    paramsArray = TokenMagic.getPreset(paramsArray);
  }
  if (!(paramsArray instanceof Array && paramsArray.length > 0)) return [];

  let filters = [];
  for (const params of paramsArray) {
    if (!params.hasOwnProperty('filterType') || !TokenMagic.filterTypes.hasOwnProperty(params.filterType)) {
      // one invalid ? all rejected.
      return [];
    }

    if (!params.hasOwnProperty('rank')) {
      params.rank = 5000;
    }

    if (!params.hasOwnProperty('filterId') || params.filterId == null) {
      params.filterId = foundry.utils.randomID();
    }

    if (!params.hasOwnProperty('enabled') || !(typeof params.enabled === 'boolean')) {
      params.enabled = true;
    }

    params.filterInternalId = foundry.utils.randomID();

    const gms = game.users.filter((user) => user.isGM);
    params.filterOwner = gms.length ? gms[0].id : game.data.userId;
    // params.placeableType = placeable._TMFXgetPlaceableType();
    params.updateId = foundry.utils.randomID();

    const filterClass = TokenMagic.filterTypes[params.filterType];
    if (filterClass) {
      class ModTMFX extends filterClass {
        assignPlaceable() {
          this.targetPlaceable = sprite.object;
          this.placeableImg = sprite;
        }

        async _TMFXsetAnimeFlag() {}
      }

      const filter = new ModTMFX(params);
      if (filter) {
        // Patch fixes
        filter.placeableImg = sprite;
        filter.targetPlaceable = sprite.object;
        // end of fixes
        filter.tvaFilter = true;
        filters.unshift(filter);
      }
    }
  }
  return filters;
}

class OutlineFilter extends foundry.canvas.rendering.filters.OutlineOverlayFilter {
  /** @inheritdoc */
  static createFragmentShader() {
    return `
    varying vec2 vTextureCoord;
    varying vec2 vFilterCoord;
    uniform sampler2D uSampler;
    
    uniform vec2 thickness;
    uniform vec4 outlineColor;
    uniform vec4 filterClamp;
    uniform float alphaThreshold;
    uniform float time;
    uniform bool knockout;
    uniform bool wave;
    
    ${this.CONSTANTS}
    ${this.WAVE()}
    
    void main(void) {
        float dist = distance(vFilterCoord, vec2(0.5)) * 2.0;
        vec4 ownColor = texture2D(uSampler, vTextureCoord);
        vec4 wColor = wave ? outlineColor * 
                             wcos(0.0, 1.0, dist * 75.0, 
                                  -time * 0.01 + 3.0 * dot(vec4(1.0), ownColor)) 
                             * 0.33 * (1.0 - dist) : vec4(0.0);
        float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
        vec4 curColor;
        float maxAlpha = 0.;
        vec2 displaced;
        for ( float angle = 0.0; angle <= TWOPI; angle += ${this.#quality.toFixed(7)} ) {
            displaced.x = vTextureCoord.x + thickness.x * cos(angle);
            displaced.y = vTextureCoord.y + thickness.y * sin(angle);
            curColor = texture2D(uSampler, clamp(displaced, filterClamp.xy, filterClamp.zw));
            curColor.a = clamp((curColor.a - 0.6) * 2.5, 0.0, 1.0);
            maxAlpha = max(maxAlpha, curColor.a);
        }
        float resultAlpha = max(maxAlpha, texAlpha);
        vec3 result = (ownColor.rgb + outlineColor.rgb * (1.0 - texAlpha)) * resultAlpha;
        gl_FragColor = vec4((ownColor.rgb + outlineColor.rgb * (1. - ownColor.a)) * resultAlpha, resultAlpha);
    }
    `;
  }

  static get #quality() {
    switch (canvas.performance.mode) {
      case CONST.CANVAS_PERFORMANCE_MODES.LOW:
        return (Math.PI * 2) / 10;
      case CONST.CANVAS_PERFORMANCE_MODES.MED:
        return (Math.PI * 2) / 20;
      default:
        return (Math.PI * 2) / 30;
    }
  }
}
