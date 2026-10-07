/** Errors the assistant's tool layer raises on purpose, with a message safe to show. */

/** A tool input the model got wrong or left ambiguous: reported back to it (not to the person) so it can retry or ask. */
export class AiToolInputError extends Error {}

/** A person's edit on a confirmation card that cannot be applied: the message is shown to the person. */
export class AiActionEditError extends Error {}
