import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: {
      insertSceneBreak: () => ReturnType;
    };
  }
}

export const SceneBreakExtension = Node.create({
  name: 'sceneBreak',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-node-type="scene-break"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-node-type': 'scene-break',
      }),
      ['span', { 'aria-hidden': 'true' }, '***'],
    ];
  },

  addCommands() {
    return {
      insertSceneBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([
              { type: this.name },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
