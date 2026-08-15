// Queries do MariaDB (dsn=dbMaria no Power BI)

// tabela "teams" -> DB_Applicattion.Comercial_Teams
export const TEAMS_SQL = `
  SELECT ct.VENDEDORES AS vendedores,
         ct.EQUIPES    AS equipes,
         ct.SITUAÇÃO   AS situacao,
         ct.ATIVO      AS ativo
  FROM DB_Applicattion.Comercial_Teams AS ct
`;

// tabela "senior_admitted" -> colaboradores ativos no Senior (RH)
export const SENIOR_SQL = `
  SELECT dsc.name           AS seller,
         dsc.admission_date AS admission_date,
         dsc.position       AS position
  FROM API_WebDeveloper.db_senior_collaborators AS dsc
  WHERE dsc.termination_date IS NULL
`;
