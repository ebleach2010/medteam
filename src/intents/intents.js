// @ts-check
// The command layer. Every player-caused change to the sim is a serializable
// POJO intent — touch UI, tests, and (later) remote co-op peers all feed the
// same pipe. Nothing in the sim reads input devices directly.

/**
 * @typedef {Object} Intent
 * @property {string} type  MOVE|GRAB|RELEASE|ACTION|TACKLE|ORDER|SELECT|SWAP_ROLE
 * @property {number} actorId  character entity id (0 = game-level intent)
 * @property {Object} [payload]
 */

export const INTENT = {
  MOVE: 'MOVE',           // payload {x, z} each in -1..1
  GRAB: 'GRAB',
  RELEASE: 'RELEASE',
  ACTION: 'ACTION',       // context-sensitive physical action
  TACKLE: 'TACKLE',
  ORDER: 'ORDER',         // payload {order, patientId} — from the radial wheel
  SELECT: 'SELECT',       // payload {modal, choice} — modal option picked
  SWAP_ROLE: 'SWAP_ROLE',
};

export const make = (type, actorId, payload) => ({ type, actorId, payload });
