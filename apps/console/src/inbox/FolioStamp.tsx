/** The folio as the console's stamp: the one reference a customer and an operator share. */
export function FolioStamp(props: { folio: string }) {
  return <span className="folio-stamp">{props.folio}</span>;
}
