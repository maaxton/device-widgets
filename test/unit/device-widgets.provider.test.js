import { describe, it, expect } from 'vitest';
// Bare specifier resolved by vitest.config.js's self-alias (device-widgets/... -> repo root).
import deviceWidgets from 'device-widgets/index.js';

/**
 * End-to-end (in-registry) proof of the extension-provided interactive widget:
 * register the extension's `widgets` block into a MOCK
 * WidgetProviderRegistry with a MOCK extension ctx, resolve
 * "device-widgets:device-toggle", then drive getData / render / actions.toggle
 * exactly as slidecast's WidgetResolver would.
 *
 * This test moved out of the monorepo (backend/test/unit/device-widgets.provider.test.js)
 * as part of marketplace v2 Phase 4 (full extraction — optional extensions live
 * in their own repos and the monorepo's backend/test imports zero optional-
 * extension source). The real WidgetProviderRegistry
 * (backend/src/sdk/WidgetProviderRegistry.js) is covered by the monorepo
 * core's own tests; MockWidgetProviderRegistry below is a faithful minimal
 * stand-in for its `register()`/`resolveById()` spec-shaping ONLY — just
 * enough to prove device-widgets' own widget spec (getData/render/actions)
 * behaves correctly once registered, not to re-test the registry itself.
 */

/**
 * A minimal, faithful stand-in for
 * backend/src/sdk/WidgetProviderRegistry.js's `register(provider, widgets, ctx)`
 * and `resolveById(qualifiedId)`. It replicates the same field defaults and
 * derivation rules (renderMode/defaultSize/refreshInterval/interactions
 * fallbacks) but PASSES THROUGH every field the widget spec itself declares
 * (type, renderMode, refreshInterval, defaultSize, interactions, actions,
 * getData, render) rather than hardcoding them, so the assertions below
 * genuinely exercise device-widgets' own spec. It intentionally omits the
 * HandlerRef/isolated-invoke branches (renderWidget/getWidgetData/
 * dispatchWidgetAction, provider-name alias swapping) since this extension's
 * widgets are always in-process functions and the test calls
 * spec.getData/spec.render/spec.actions.toggle directly, mirroring how
 * WidgetResolver invokes them.
 */
class MockWidgetProviderRegistry {
  constructor() {
    /** @type {Map<string, Map<string, object>>} */
    this._extensions = new Map();
  }

  register(extensionName, widgets, ctx) {
    if (!widgets) return;

    const entries = Array.isArray(widgets)
      ? widgets.map((w) => [w && w.type, w])
      : Object.entries(widgets).map(([type, w]) => [type, { type, ...w }]);

    let typeMap = this._extensions.get(extensionName);
    if (!typeMap) {
      typeMap = new Map();
      this._extensions.set(extensionName, typeMap);
    }

    for (const [type, spec] of entries) {
      if (!type || typeof type !== 'string') continue;
      if (!spec || typeof spec.render !== 'function') continue;
      typeMap.set(type, {
        type,
        name: spec.name || type,
        renderMode: spec.renderMode || 'image',
        configSchema: spec.configSchema || {},
        styleSchema: spec.styleSchema || {},
        defaultSize: spec.defaultSize || { width: 300, height: 150 },
        refreshInterval: typeof spec.refreshInterval === 'number' ? spec.refreshInterval : 60000,
        getData: typeof spec.getData === 'function' ? spec.getData : null,
        render: spec.render,
        actions: spec.actions && typeof spec.actions === 'object' ? spec.actions : {},
        interactions: Array.isArray(spec.interactions)
          ? spec.interactions
          : Object.keys(spec.actions && typeof spec.actions === 'object' ? spec.actions : {})
            .map((a) => ({ action: a, label: a })),
        ctx,
      });
    }
  }

  resolve(provider, type) {
    const typeMap = this._extensions.get(provider);
    if (!typeMap) return null;
    const spec = typeMap.get(type);
    if (!spec) return null;
    return { provider, ...spec };
  }

  resolveById(qualifiedId) {
    if (typeof qualifiedId !== 'string' || !qualifiedId.includes(':')) return null;
    const idx = qualifiedId.indexOf(':');
    const provider = qualifiedId.slice(0, idx);
    const type = qualifiedId.slice(idx + 1);
    return this.resolve(provider, type);
  }
}

// A mock ctx.entities mirroring the real "platform-lite" verb shape (fork-host Wave 3
// Task 1 — ContextFactory ctx.entities = { getState, executeCommand }, same
// signature/return in-process and isolated). The switch starts 'on'; executeCommand
// ('toggle') flips the mock store so a subsequent read would observe the change.
// getState on an unknown entity id resolves `null` (mirrors StateManager.getState),
// which the widget must fall back on gracefully (source: 'virtual').
function makeMockCtx(initialState = 'on') {
  const store = { 'switch.virtual_stage': initialState };
  const commandCalls = [];
  const getStateCalls = [];
  return {
    ctx: {
      state: {},
      entities: {
        getState: async (entityId) => {
          getStateCalls.push(entityId);
          const state = store[entityId];
          return state === undefined ? null : { state, attributes: {} };
        },
        executeCommand: async (entityId, command, params) => {
          commandCalls.push({ entityId, command, params });
          if (command === 'toggle' && store[entityId] !== undefined) {
            store[entityId] = store[entityId] === 'on' ? 'off' : 'on';
          }
          return { success: true };
        },
      },
    },
    store,
    commandCalls,
    getStateCalls,
  };
}

describe('device-widgets: extension-provided interactive device-toggle widget', () => {
  it('has a well-formed widgets block (render fn, getData fn, actions object)', () => {
    expect(Array.isArray(deviceWidgets.widgets)).toBe(true);
    const [spec] = deviceWidgets.widgets;
    expect(spec.type).toBe('device-toggle');
    expect(typeof spec.render).toBe('function');
    expect(typeof spec.getData).toBe('function');
    expect(typeof spec.actions).toBe('object');
    expect(typeof spec.actions.toggle).toBe('function');
  });

  it('registers into WidgetProviderRegistry and resolves by provider:type', () => {
    const { ctx } = makeMockCtx();
    const reg = new MockWidgetProviderRegistry();
    reg.register('device-widgets', deviceWidgets.widgets, ctx);

    const spec = reg.resolveById('device-widgets:device-toggle');
    expect(spec).toBeTruthy();
    expect(spec.provider).toBe('device-widgets');
    expect(spec.type).toBe('device-toggle');
    expect(spec.renderMode).toBe('image');
    expect(spec.refreshInterval).toBe(5000);
    expect(spec.defaultSize).toEqual({ width: 400, height: 200 });
    // Interaction surfaced to the render pipeline + device.
    expect(spec.interactions).toEqual([{ action: 'toggle', label: 'Toggle' }]);
    // Bound to the extension's own ctx (captured at register time).
    expect(spec.ctx).toBe(ctx);
    expect(typeof spec.actions.toggle).toBe('function');
  });

  it('render() returns a primitives object the widgetRenderer can draw', async () => {
    const { ctx, getStateCalls } = makeMockCtx('on');
    const reg = new MockWidgetProviderRegistry();
    reg.register('device-widgets', deviceWidgets.widgets, ctx);
    const spec = reg.resolveById('device-widgets:device-toggle');

    const config = { entity_id: 'switch.virtual_stage' };
    const data = await spec.getData(spec.ctx, { config });
    expect(data).toEqual({
      entityId: 'switch.virtual_stage', state: 'on', available: true, source: 'entity',
    });
    // getData reads the live state via ctx.entities.getState(entityId) (fork-host
    // Wave 3 Task 3 -- was ctx.platform.stateManager.getState before this refactor).
    expect(getStateCalls).toEqual(['switch.virtual_stage']);

    const primitives = await spec.render(spec.ctx, { config, data, size: spec.defaultSize });
    // A single primitives object (not an array), rooted on a supported node.
    expect(primitives).toBeTruthy();
    expect(typeof primitives).toBe('object');
    expect(Array.isArray(primitives)).toBe(false);
    expect(primitives.type).toBe('box');
    expect(Array.isArray(primitives.children)).toBe(true);

    // Only supported node types (box/stack/text) appear anywhere in the tree.
    const supported = new Set(['box', 'stack', 'text', 'icon', 'image', 'spacer', 'divider']);
    const collectTypes = (node, acc) => {
      if (!node || typeof node !== 'object') return acc;
      if (node.type) acc.add(node.type);
      const kids = Array.isArray(node.children) ? node.children : [];
      kids.forEach((k) => collectTypes(k, acc));
      return acc;
    };
    const types = collectTypes(primitives, new Set());
    for (const t of types) expect(supported.has(t)).toBe(true);

    // The tree surfaces the entity id, the live state, and the OK hint.
    const flatText = JSON.stringify(primitives);
    expect(flatText).toContain('switch.virtual_stage');
    expect(flatText).toContain('ON');
    expect(flatText).toContain('Press OK to toggle');
  });

  it('actions.toggle flips the entity via ctx.entities.executeCommand', async () => {
    const { ctx, store, commandCalls } = makeMockCtx('on');
    const reg = new MockWidgetProviderRegistry();
    reg.register('device-widgets', deviceWidgets.widgets, ctx);
    const spec = reg.resolveById('device-widgets:device-toggle');

    const config = { entity_id: 'switch.virtual_stage' };
    const result = await spec.actions.toggle(spec.ctx, { config });

    expect(result).toEqual({ ok: true, source: 'entity', newState: 'off' });
    // Reached the generic command path (ctx.entities.executeCommand) with the right
    // entity + command.
    expect(commandCalls).toEqual([
      { entityId: 'switch.virtual_stage', command: 'toggle', params: {} },
    ]);
    // The mock store flipped, proving the command was actually dispatched.
    expect(store['switch.virtual_stage']).toBe('off');
  });

  it('falls back to a self-contained virtual toggle when no live entity, and the action flips it', async () => {
    const { ctx, commandCalls, getStateCalls } = makeMockCtx('on');
    const reg = new MockWidgetProviderRegistry();
    reg.register('device-widgets', deviceWidgets.widgets, ctx);
    const spec = reg.resolveById('device-widgets:device-toggle');

    // No such live entity → ctx.entities.getState resolves null (unknown entity id,
    // mirroring the real StateManager.getState contract) → virtual mode, default off.
    const config = { entity_id: 'switch.does_not_exist' };
    const data = await spec.getData(spec.ctx, { config });
    expect(data).toEqual({
      entityId: 'switch.does_not_exist', state: 'off', available: true, source: 'virtual',
    });
    // getState was actually called (and returned null) -- the fallback is a
    // graceful null-handling branch, not a skip of the verb entirely.
    expect(getStateCalls).toContain('switch.does_not_exist');

    // The action flips the virtual state in the extension's shared ctx.state —
    // no device command is issued (no live entity).
    const r1 = await spec.actions.toggle(spec.ctx, { config });
    expect(r1).toEqual({ ok: true, source: 'virtual', newState: 'on' });
    expect(commandCalls).toEqual([]); // never touched a device

    // getData now reflects the flipped virtual state (shared ctx.state), which is
    // exactly what makes the on-device interaction loop observable.
    const data2 = await spec.getData(spec.ctx, { config });
    expect(data2.state).toBe('on');

    const r2 = await spec.actions.toggle(spec.ctx, { config });
    expect(r2.newState).toBe('off');
  });
});
