/**
 * Device Widgets Extension -- SDK v2
 *
 * A worked example of an EXTENSION-PROVIDED, INTERACTIVE widget. It proves the
 * new widget-provider + interaction architecture end to end:
 *
 *   1. This extension's default export declares a `widgets` block. At load time
 *      ExtensionLoader Step 10.6 registers it into the platform
 *      WidgetProviderRegistry (backend/src/sdk/WidgetProviderRegistry.js), bound
 *      to this extension's OWN base ctx (so the widget fns reach ctx.entities).
 *   2. Slidecast's WidgetResolver (extensions/slidecast/widgets/WidgetResolver.js)
 *      resolves the reference "device-widgets:device-toggle" to a contract and
 *      drives getData -> render (produce) and dispatchAction -> actions.toggle.
 *
 * The single widget, `device-toggle`, renders the live state of a togglable
 * entity and -- on an OK-press interaction -- flips it via the SAME generic
 * command path the REST route uses (EntityRegistry.executeCommand ->
 * DeviceManager). It targets the virtual test device's switch entity
 * (`switch.virtual_stage`, states on/off, command `toggle`) so the example is
 * exercisable end to end with no hardware (extensions/virtual-device/index.js).
 *
 * Nothing here is device-specific beyond the default config value -- any
 * togglable entity_id + a `toggle` command works; the entity is reached
 * generically through ctx.entities.getState/executeCommand (the fork-host
 * Wave 3 "platform-lite" verbs -- backend/src/sdk/ContextFactory.js -- which
 * ARE isolatable, unlike ctx.platform.*).
 */

// The virtual test device's togglable switch entity (extensions/virtual-device).
// state is 'on' | 'off'; its devices.virtual.commands.toggle flips it.
const DEFAULT_ENTITY_ID = 'switch.virtual_stage';

/**
 * Read an entity's current state via ctx.entities.getState (the platform-lite verb --
 * same signature/return in-process and isolated). A null return (unknown entity id, or
 * genuinely no state recorded yet) is preserved as `state: null, available: false` so
 * callers fall back to the self-contained virtual toggle.
 * @returns {Promise<{ state: string|null, available: boolean }>}
 */
async function readEntityState(ctx, entityId) {
  try {
    const stateObj = await ctx.entities.getState(entityId);
    const state = stateObj ? stateObj.state : null;
    const available = state !== null && state !== undefined && state !== 'unavailable';
    return { state, available };
  } catch (_e) {
    return { state: null, available: false };
  }
}

// ============================================
// Widget type: device-toggle
// ============================================
const deviceToggleWidget = {
  type: 'device-toggle',
  name: 'Device Toggle',
  renderMode: 'image',
  refreshInterval: 5000,
  defaultSize: { width: 400, height: 200 },

  configSchema: {
    entity_id: {
      type: 'string',
      label: 'Entity',
      default: DEFAULT_ENTITY_ID,
    },
  },

  styleSchema: {},

  // getData -- read the live entity state from the platform.
  getData: async (ctx, { config = {} } = {}) => {
    const entityId = config.entity_id || DEFAULT_ENTITY_ID;
    const { state, available } = await readEntityState(ctx, entityId);
    if (available) {
      return {
        entityId, state, available: true, source: 'entity',
      };
    }
    // No live entity → self-contained virtual toggle. State lives in this
    // extension's shared ctx.state (the same object getData and the action both
    // see), so the interaction loop is provable end to end with no hardware.
    const store = ctx.state.deviceToggle || (ctx.state.deviceToggle = {});
    const v = store[entityId] === 'on' ? 'on' : 'off';
    return {
      entityId, state: v, available: true, source: 'virtual',
    };
  },

  // render -- a primitives tree the existing widgetRenderer can draw (only
  // box/stack/text node types are used). Shows the entity id, its live state
  // (large, color-coded), and the interaction hint.
  render: (ctx, {
    config = {}, data = {}, size = null,
  } = {}) => {
    const entityId = data.entityId || config.entity_id || DEFAULT_ENTITY_ID;
    const stateRaw = data.state;
    const isOn = stateRaw === 'on';
    const stateLabel = data.available && stateRaw
      ? String(stateRaw).toUpperCase()
      : 'UNAVAILABLE';

    // Color-code the card by state: green = on, slate = off/unavailable.
    const background = data.available
      ? (isOn
        ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
        : 'linear-gradient(135deg, #334155 0%, #1e293b 100%)')
      : 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)';

    return {
      type: 'box',
      background,
      borderRadius: 20,
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      children: [
        {
          type: 'stack',
          direction: 'vertical',
          width: '100%',
          height: '100%',
          padding: 24,
          gap: 8,
          justify: 'center',
          align: 'flex-start',
          children: [
            {
              type: 'text',
              content: entityId,
              style: {
                fontSize: 18,
                fontWeight: '600',
                color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.5px',
              },
            },
            {
              type: 'text',
              content: stateLabel,
              style: {
                fontSize: 64,
                fontWeight: '800',
                color: '#ffffff',
                lineHeight: 1,
              },
            },
            {
              type: 'text',
              content: 'Press OK to toggle',
              style: {
                fontSize: 16,
                fontWeight: '500',
                color: 'rgba(255,255,255,0.75)',
              },
            },
          ],
        },
      ],
      // size is available for callers that need it; the tree fills 100% of the
      // layer, so we don't hardcode pixels. Referenced to keep it meaningful.
      _size: size,
    };
  },

  // Focusable interaction surfaced to the render pipeline + the device
  // (OK-press -> action 'toggle').
  interactions: [{ action: 'toggle', label: 'Toggle' }],

  // actions -- run in THIS extension's ctx (captured at register time). Flip
  // the entity through the generic command path the REST command route uses:
  // ctx.entities.executeCommand(entityId, command, params) -> EntityRegistry.executeCommand
  // -> commandDispatcher -> DeviceManager.executeCommand -> the devices: block command fn.
  actions: {
    toggle: async (ctx, { config = {} } = {}) => {
      const entityId = config.entity_id || DEFAULT_ENTITY_ID;
      const { state: prevState, available } = await readEntityState(ctx, entityId);

      // Live entity → command it through the generic path (ctx.entities.executeCommand ->
      // EntityRegistry.executeCommand -> DeviceManager -> the devices: block command fn).
      // Domain-aware: switch/light expose `toggle`; media_player uses turn_on/turn_off.
      if (available) {
        const domain = String(entityId).split('.')[0];
        const isOn = prevState === 'on' || prevState === 'playing';
        if (domain === 'switch' || domain === 'light') {
          await ctx.entities.executeCommand(entityId, 'toggle', {});
        } else {
          await ctx.entities.executeCommand(entityId, isOn ? 'turn_off' : 'turn_on', {});
        }
        return { ok: true, source: 'entity', newState: isOn ? 'off' : 'on' };
      }

      // No live entity → flip the self-contained virtual toggle.
      const store = ctx.state.deviceToggle || (ctx.state.deviceToggle = {});
      store[entityId] = store[entityId] === 'on' ? 'off' : 'on';
      return { ok: true, source: 'virtual', newState: store[entityId] };
    },
  },
};

// ============================================
// Extension Definition
// ============================================
export default {
  name: 'device-widgets',
  version: '1.0.0',
  description: 'Extension-provided interactive widgets for controlling platform devices.',
  requires: ['slidecast'],
  provides: ['device-widgets'],

  // Declarative widget types -- registered into the platform
  // WidgetProviderRegistry by ExtensionLoader Step 10.6.
  widgets: [deviceToggleWidget],

  // === UI contributions (spec §6 / D9, Wave 5 Slice 5.4 -- studioElements) ===
  // Proves the studioElements slot end to end. `widgetType: 'device-toggle'`
  // links this contribution to the `device-toggle` widget type declared above
  // -- the slidecast studio toolbar surfaces a dedicated "Device Toggle"
  // button (instead of burying it in the generic Widget picker) that places
  // the SAME widget element the picker already would (widgetUuid =
  // 'device-widgets:device-toggle'), so placement/render keep going through
  // the existing WidgetProviderRegistry/WidgetResolver path -- no second
  // render mechanism. componentPath 'studio-element' resolves to
  // frontend-routes/device-widgets/studio-element/+page.svelte, a friendlier
  // entity-picker config panel that mounts in the studio's widget config
  // window in place of the generic schema-driven form.
  contributions: {
    studioElements: [
      {
        componentPath: 'studio-element',
        label: 'Device Toggle',
        widgetType: 'device-toggle',
        order: 10,
      },
    ],
  },

  init: async (ctx) => {
    ctx.log('device-widgets loaded -- device-toggle widget registered', 'info');
  },
};
