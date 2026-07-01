const DEFAULT_LEAGUE = 27;
const DEFAULT_SEASON = 188;
const DEFAULT_BASE_URL = "https://sports.bzzoiro.com";

type ApiFixture = {
  id?: number;
  league_id?: number;
  season_id?: number;
  home_team_id?: number;
  home_team?: string;
  away_team_id?: number;
  away_team?: string;
  venue_id?: number | null;
  event_date?: string;
  status?: string;
  round_name?: string | null;
  group_name?: string | null;
  home_score?: number | null;
  away_score?: number | null;
};

type ApiTeam = {
  id?: number;
  name?: string;
};

type ApiVenue = {
  id?: number | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
};

export default {
  async importWorldCup(ctx) {
    const { strapi } = global;
    const user = ctx.state.user;

    if (!user || !(await isAdminUser(strapi, user))) {
      return ctx.forbidden("Apenas administradores podem importar dados.");
    }

    const apiKey = process.env.BZZOIRO_API_KEY;
    if (!apiKey) {
      return ctx.badRequest("BZZOIRO_API_KEY nao configurada.");
    }

    const baseUrl = resolveBzzoiroBaseUrl();

    const league = Number(ctx.request.body?.league || DEFAULT_LEAGUE);
    const season = Number(ctx.request.body?.season || DEFAULT_SEASON);
    let fixtures: ApiFixture[] = [];

    try {
      fixtures = await fetchWorldCupFixtures(apiKey, baseUrl, league, season);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido.";
      return ctx.badRequest(message);
    }

    const stats = {
      fixtures: fixtures.length,
      teams: 0,
      venues: 0,
      matches: 0,
      skipped: 0,
      removedPlaceholders: 0,
      removedOrphanRelations: 0,
    };

    stats.removedOrphanRelations += await cleanupOrphanRelations(strapi);
    stats.removedPlaceholders = await cleanupPlaceholderData(strapi);
    stats.removedOrphanRelations += await cleanupOrphanRelations(strapi);

    for (const fixture of fixtures) {
      const home = { id: fixture.home_team_id, name: fixture.home_team };
      const away = { id: fixture.away_team_id, name: fixture.away_team };

      if (
        !fixture.id ||
        !home.id ||
        !away.id ||
        !home.name ||
        !away.name ||
        isPlaceholderTeamName(home.name) ||
        isPlaceholderTeamName(away.name)
      ) {
        stats.skipped += 1;
        continue;
      }

      const homeTeam = await upsertTeam(strapi, home);
      const awayTeam = await upsertTeam(strapi, away);
      const venueData = await fetchVenue(apiKey, baseUrl, fixture.venue_id);
      const venue = await upsertVenue(strapi, venueData);

      stats.teams += Number(homeTeam.created) + Number(awayTeam.created);
      stats.venues += Number(venue?.created || 0);

      const savedMatch = await upsertMatch(strapi, fixture, {
        homeTeamId: homeTeam.entry.id,
        awayTeamId: awayTeam.entry.id,
        venueId: venue?.entry.id,
        homeTeamDocumentId: homeTeam.entry.documentId,
        awayTeamDocumentId: awayTeam.entry.documentId,
        venueDocumentId: venue?.entry.documentId,
      });

      stats.matches += 1;
    }

    if (stats.matches === 0) {
      return ctx.badRequest(
        `A API devolveu ${stats.fixtures} jogos para Mundial ${season}, mas nenhum tinha o formato esperado.`
      );
    }

    ctx.body = {
      imported: stats,
      league,
      season_id: season,
    };
  },
};

async function fetchWorldCupFixtures(apiKey: string, baseUrl: string, league: number, season: number) {
  const fixtures: ApiFixture[] = [];
  let nextUrl: string | null =
    `${baseUrl}/api/v2/events/?league_id=${league}&season_id=${season}&limit=200&offset=0`;

  while (nextUrl) {
    const payload = await bzzoiroRequest<{
      count?: number;
      next?: string | null;
      results?: ApiFixture[];
    }>(apiKey, nextUrl);

    fixtures.push(...(payload.results || []));
    nextUrl = payload.next || null;
  }

  if (fixtures.length === 0) {
    throw new Error(
      `A API Bzzoiro devolveu 0 jogos para league_id=${league} e season_id=${season}.`
    );
  }

  return fixtures;
}

function resolveBzzoiroBaseUrl() {
  const configuredUrl = process.env.BZZOIRO_API_BASE_URL?.trim();

  if (!configuredUrl || configuredUrl.includes("api-sports.io")) {
    return DEFAULT_BASE_URL;
  }

  return configuredUrl.replace(/\/$/, "");
}

async function fetchVenue(apiKey: string, baseUrl: string, venueId?: number | null) {
  if (!venueId) return null;

  try {
    return await bzzoiroRequest<ApiVenue>(apiKey, `${baseUrl}/api/v2/venues/${venueId}/`);
  } catch {
    return {
      id: venueId,
      name: `Estadio ${venueId}`,
    };
  }
}

async function bzzoiroRequest<T>(apiKey: string, url: string) {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });
  } catch {
    throw new Error(`Nao foi possivel ligar a API externa em ${url}.`);
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Erro ao chamar API Bzzoiro: ${response.status}${details ? ` - ${details}` : ""}`);
  }

  return (await response.json()) as T;
}

async function upsertTeam(strapi: any, team: ApiTeam) {
  const existing = await strapi.db.query("api::team.team").findOne({
    where: { externalId: team.id },
  });

  const data = {
    externalId: team.id,
    name: team.name,
    publishedAt: new Date().toISOString(),
  };

  if (existing) {
    return {
      entry: await strapi.db.query("api::team.team").update({
        where: { id: existing.id },
        data,
      }),
      created: false,
    };
  }

  return {
    entry: await strapi.documents("api::team.team").create({
      data,
      status: "published",
    }),
    created: true,
  };
}

async function upsertVenue(strapi: any, venue?: ApiVenue | null) {
  if (!venue?.name) {
    return null;
  }

  const where = venue.id ? { externalId: venue.id } : { nome: venue.name };
  const existing = await strapi.db.query("api::estadio.estadio").findOne({ where });
  const data = {
    externalId: venue.id || null,
    nome: [venue.name, venue.city, venue.country].filter(Boolean).join(" - "),
    publishedAt: new Date().toISOString(),
  };

  if (existing) {
    return {
      entry: await strapi.db.query("api::estadio.estadio").update({
        where: { id: existing.id },
        data,
      }),
      created: false,
    };
  }

  return {
    entry: await strapi.documents("api::estadio.estadio").create({
      data,
      status: "published",
    }),
    created: true,
  };
}

async function upsertMatch(
  strapi: any,
  fixture: ApiFixture,
  relations: {
    homeTeamId: number;
    awayTeamId: number;
    venueId?: number;
    homeTeamDocumentId: string;
    awayTeamDocumentId: string;
    venueDocumentId?: string;
  }
) {
  const existing = await strapi.db.query("api::jogo.jogo").findOne({
    where: { externalId: fixture.id },
  });
  const baseData = {
    externalId: fixture.id,
    data: fixture.event_date || null,
    fase: fixture.group_name || fixture.round_name || "",
    estado: mapStatus(fixture.status),
    golos_casa: fixture.home_score ?? 0,
    golos_fora: fixture.away_score ?? 0,
    publishedAt: new Date().toISOString(),
  };

  if (existing) {
    return {
      entry: await strapi.db.query("api::jogo.jogo").update({
        where: { id: existing.id },
        data: {
          ...baseData,
          equipa_casa: relations.homeTeamId,
          equipa_fora: relations.awayTeamId,
          estadio: relations.venueId,
        },
      }),
      created: false,
    };
  }

  return {
    entry: await strapi.documents("api::jogo.jogo").create({
      data: {
        ...baseData,
        equipa_casa: relations.homeTeamDocumentId,
        equipa_fora: relations.awayTeamDocumentId,
        estadio: relations.venueDocumentId,
      },
      status: "published",
    }),
    created: true,
  };
}

function mapStatus(status?: string) {
  if (status === "finished") return "Terminado";
  if (status === "live") {
    return "A decorrer";
  }
  return "Agendado";
}

function isPlaceholderTeamName(name?: string | null) {
  return /^[WL]\d+$/i.test((name || "").trim());
}

async function cleanupPlaceholderData(strapi: any) {
  const placeholderTeams = await strapi.db.query("api::team.team").findMany({
    where: {},
  });
  const placeholderIds = new Set(
    placeholderTeams
      .filter((team: { name?: string }) => isPlaceholderTeamName(team.name))
      .map((team: { id: number }) => team.id)
  );

  if (placeholderIds.size === 0) {
    return 0;
  }

  const jogos = await strapi.db.query("api::jogo.jogo").findMany({
    populate: ["equipa_casa", "equipa_fora"],
  });
  const favoritos = await strapi.db.query("api::favorito.favorito").findMany({
    populate: ["team"],
  });

  let removed = 0;

  for (const favorito of favoritos) {
    if (placeholderIds.has(favorito.team?.id)) {
      await strapi.db.query("api::favorito.favorito").delete({
        where: { id: favorito.id },
      });
      removed += 1;
    }
  }

  for (const jogo of jogos) {
    if (placeholderIds.has(jogo.equipa_casa?.id) || placeholderIds.has(jogo.equipa_fora?.id)) {
      await strapi.db.query("api::jogo.jogo").delete({
        where: { id: jogo.id },
      });
      removed += 1;
    }
  }

  for (const teamId of placeholderIds) {
    await strapi.db.query("api::team.team").delete({
      where: { id: teamId },
    });
    removed += 1;
  }

  return removed;
}

async function cleanupOrphanRelations(strapi: any) {
  const db = strapi.db.connection;
  let removed = 0;

  removed += await deleteOrphanLinks(db, "jogos_equipa_casa_lnk", [
    ["jogo_id", "jogos"],
    ["team_id", "teams"],
  ]);
  removed += await deleteOrphanLinks(db, "jogos_equipa_fora_lnk", [
    ["jogo_id", "jogos"],
    ["team_id", "teams"],
  ]);
  removed += await deleteOrphanLinks(db, "jogos_estadio_lnk", [
    ["jogo_id", "jogos"],
    ["estadio_id", "estadios"],
  ]);
  removed += await deleteOrphanLinks(db, "favoritos_team_lnk", [
    ["favorito_id", "favoritos"],
    ["team_id", "teams"],
  ]);
  removed += await deleteOrphanLinks(db, "favoritos_user_lnk", [
    ["favorito_id", "favoritos"],
    ["user_id", "up_users"],
  ]);

  return removed;
}

async function deleteOrphanLinks(
  db: any,
  linkTable: string,
  references: [column: string, targetTable: string][]
) {
  let removed = 0;

  for (const [column, targetTable] of references) {
    const result = await db(linkTable)
      .whereNotIn(column, db.select("id").from(targetTable))
      .delete();
    removed += Number(result || 0);
  }

  return removed;
}

async function isAdminUser(strapi: any, user: any) {
  const role = user?.role || (await findUserRole(strapi, user?.id));
  const roleType = role?.type?.toLowerCase();
  const roleName = role?.name?.toLowerCase();

  return roleType === "admin" || roleName === "admin" || roleName === "administrador";
}

async function findUserRole(strapi: any, userId: number) {
  if (!userId) return null;

  const user = await strapi.db.query("plugin::users-permissions.user").findOne({
    where: { id: userId },
    populate: ["role"],
  });

  return user?.role || null;
}
