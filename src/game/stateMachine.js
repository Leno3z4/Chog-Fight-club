export class StateMachine {
  constructor(owner, initialState) {
    this.owner = owner;
    this.states = new Map();
    this.current = null;
    this.currentName = null;
    if (initialState) this.change(initialState);
  }

  add(name, state) {
    this.states.set(name, state);
    return this;
  }

  canChange(name) {
    return this.states.has(name) && name !== this.currentName;
  }

  change(name, payload = {}) {
    const next = this.states.get(name);
    if (!next) throw new Error(`Unknown state: ${name}`);
    if (this.currentName === name) return false;

    this.current?.exit?.(this.owner, payload);
    this.current = next;
    this.currentName = name;
    this.current.enter?.(this.owner, payload);
    return true;
  }

  update(delta) {
    this.current?.update?.(this.owner, delta);
  }

  is(name) {
    return this.currentName === name;
  }
}

export class CharacterState {
  enter() {}
  update() {}
  exit() {}
}
