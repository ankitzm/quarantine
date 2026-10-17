export type QueryMode = 'read' | 'write';

/**
 * A registered Cypher statement. `Row` is a phantom type describing one result row;
 * it is never present at runtime.
 */
export interface Query<Row = unknown> {
  readonly name: string;
  readonly description: string;
  readonly cypher: string;
  readonly mode: QueryMode;
  readonly __row?: Row;
}

export const defineQuery = <Row = never>(q: Omit<Query<Row>, '__row'>): Query<Row> => q;
