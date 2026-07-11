<script>
  // device-widgets "studioElements" contribution (spec §6 / D9, Wave 5 Slice
  // 5.4) — the config panel for the toolbar-placeable "Device Toggle" studio
  // element. Declared in ../../../index.js's `contributions.studioElements`
  // with widgetType: 'device-toggle', linking this panel to the SAME widget
  // type registered in the `widgets` block. Placement + signage render both
  // stay on the existing WidgetProviderRegistry/WidgetResolver path (the
  // placed element is a normal type:'widget' element with widgetUuid
  // 'device-widgets:device-toggle') — this panel ONLY replaces the generic
  // schema-driven config UI slidecast's studio would otherwise show, with a
  // real entity picker instead of a free-text entity_id field.
  //
  // Mounted inline by the studio's WidgetConfigWindow via
  // <HostSlot slot="studioElements" filter={...} componentProps={{element,
  // onChange}} /> — element is the SAME object the studio canvas renders
  // from, so mutating element.widgetConfig here and calling onChange() is
  // enough to re-run the widget and persist the change (mirrors how
  // WidgetConfigWindow's own generic fields work).
  import { onMount } from 'svelte';

  export let element = null;
  export let onChange = () => {};

  const DEFAULT_ENTITY_ID = 'switch.virtual_stage';

  let loading = true;
  let error = null;
  let entities = []; // togglable entities: [{ entity_id, name, domain, state }]
  let customMode = false;

  $: if (element && !element.widgetConfig) element.widgetConfig = {};
  $: entityId = element?.widgetConfig?.entity_id ?? DEFAULT_ENTITY_ID;
  $: knownEntity = entities.some((e) => e.entity_id === entityId);

  onMount(async () => {
    try {
      const res = await fetch('/api/devices/entities');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const flat = [];
      for (const device of data.devices || []) {
        for (const e of device.entities || []) {
          const domain = e.domain || String(e.entity_id).split('.')[0];
          if (domain === 'switch' || domain === 'light') {
            flat.push({
              entity_id: e.entity_id,
              name: e.name || e.entity_id,
              domain,
              state: e.state?.state ?? null,
            });
          }
        }
      }
      entities = flat.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      error = e.message || 'Failed to load entities';
    } finally {
      loading = false;
      // No known togglable entity yet (fresh install, no devices claimed) —
      // start in free-text mode so the field is still usable.
      if (!knownEntity) customMode = true;
    }
  });

  function setEntity(value) {
    if (!element) return;
    if (!element.widgetConfig) element.widgetConfig = {};
    element.widgetConfig.entity_id = value;
    onChange();
  }

  function handleSelect(e) {
    const { value } = e.target;
    if (value === '__custom__') {
      customMode = true;
      return;
    }
    customMode = false;
    setEntity(value);
  }

  function handleCustomInput(e) {
    setEntity(e.target.value);
  }
</script>

<div class="device-toggle-config">
  <label class="field-label" for="device-toggle-entity">Entity</label>

  {#if loading}
    <p class="hint">Loading togglable entities&hellip;</p>
  {:else}
    {#if error}
      <p class="hint hint-error">{error} — enter an entity id manually.</p>
    {/if}

    {#if !customMode}
      <select id="device-toggle-entity" value={entityId} on:change={handleSelect}>
        {#if !knownEntity}
          <option value={entityId}>{entityId} (not found)</option>
        {/if}
        {#each entities as e (e.entity_id)}
          <option value={e.entity_id}>{e.name} — {e.entity_id}{e.state ? ` (${e.state})` : ''}</option>
        {/each}
        <option value="__custom__">Custom entity id&hellip;</option>
      </select>
    {:else}
      <input
        id="device-toggle-entity"
        type="text"
        placeholder="switch.my_device"
        value={entityId}
        on:input={handleCustomInput}
      />
      {#if entities.length > 0}
        <button type="button" class="link-btn" on:click={() => { customMode = false; }}>
          Choose from list instead
        </button>
      {/if}
    {/if}

    <p class="hint">
      The Device Toggle widget shows this entity's live state and flips it via the
      platform's generic command path when pressed on the device.
    </p>
  {/if}
</div>

<style>
  .device-toggle-config {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgb(var(--color-text-secondary));
  }

  select,
  input[type='text'] {
    width: 100%;
    padding: 0.5rem 0.6rem;
    font-size: 0.85rem;
    background: rgb(var(--color-surface-alt, var(--color-surface)));
    border: 1px solid rgb(var(--color-border));
    border-radius: var(--jewel-radius-md, 8px);
    color: rgb(var(--color-text));
  }

  .link-btn {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8rem;
    color: rgb(var(--color-primary));
    cursor: pointer;
    text-decoration: underline;
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: rgb(var(--color-text-secondary));
    line-height: 1.4;
  }

  .hint-error {
    color: rgb(var(--color-warning, 245, 158, 11));
  }
</style>
