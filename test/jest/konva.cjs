// Canvas is supplied by the browser in production. Unit tests use this minimal scene graph.

const noop = () => {};
class KonvaNode {
  on = noop;
  off = noop;
  destroy = noop;
  remove = noop;
  getLayer() {
    return null;
  }
  getStage() {
    return null;
  }
  getParent() {
    return null;
  }
}
class Transformer extends KonvaNode {
  nodes() {
    return [];
  }
  forceUpdate = noop;
}
class Transform {
  m = [1, 0, 0, 1, 0, 0];
  copy() {
    return new Transform();
  }
  point(p) {
    return p;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
  rotate() {
    return this;
  }
  invert() {
    return this;
  }
  getMatrix() {
    return this.m;
  }
  multiply() {
    return this;
  }
}
const konva = {
  Transformer,
  Transform,
  Node: KonvaNode,
  Group: class extends KonvaNode {},
  Layer: class extends KonvaNode {},
  Stage: class extends KonvaNode {},
  Rect: class extends KonvaNode {},
  Circle: class extends KonvaNode {},
  Line: class extends KonvaNode {},
  Image: class extends KonvaNode {},
  Text: class extends KonvaNode {},
  Shape: class extends KonvaNode {},
  Arrow: class extends KonvaNode {},
  Path: class extends KonvaNode {},
  Label: class extends KonvaNode {},
  Tag: class extends KonvaNode {},
  Ring: class extends KonvaNode {},
  getAngle: (a) => a,
  showWarnings: false,
};
module.exports = konva;
