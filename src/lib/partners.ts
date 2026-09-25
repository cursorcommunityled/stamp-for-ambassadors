/**
 * The partners one event can use: the shared list, the ones added on this
 * event's page, and any that have codes here because leftovers were moved
 * in. Everything else belongs to another night and stays out of its pickers,
 * its forms, and its guests' pages.
 */
export function partnersFor(eventId: string) {
  return {
    OR: [
      { eventId: null },
      { eventId },
      { codes: { some: { eventId } } },
    ],
  };
}
