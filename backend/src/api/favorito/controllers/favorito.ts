/**
 * favorito controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController("api::favorito.favorito", ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;

    if (!user) {
      ctx.body = {
        data: [],
        meta: {},
      };
      return;
    }

    const where = (await isAdminUser(strapi, user)) ? {} : { user: user.id };
    const favoritos = await strapi.db.query("api::favorito.favorito").findMany({
      where,
      populate: ["team", "user"],
      orderBy: { createdAt: "desc" },
    });
    const uniqueFavoritos = await removeDuplicateFavorites(strapi, favoritos);

    ctx.body = {
      data: uniqueFavoritos,
      meta: {},
    };
  },

  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Precisas de iniciar sessao para adicionar favoritos.");
    }

    const team = await findTeam(strapi, ctx.request.body?.data?.team);

    if (!team) {
      return ctx.badRequest("Equipa nao encontrada.");
    }

    const existingFavorite = await findFavoriteByUserAndTeam(strapi, user.id, team.id);

    if (existingFavorite) {
      ctx.body = {
        data: existingFavorite,
        meta: {
          alreadyExists: true,
        },
      };
      return;
    }

    ctx.request.body = {
      data: {
        ...(ctx.request.body?.data || {}),
        team: team.id,
        user: user.id,
      },
    };

    return super.create(ctx);
  },

  async delete(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Precisas de iniciar sessao para remover favoritos.");
    }

    if (!(await isAdminUser(strapi, user))) {
      const favorito = await findFavorito(strapi, ctx.params.id);
      const ownerId = favorito?.user?.id;

      if (!favorito) {
        return ctx.notFound("Favorito nao encontrado.");
      }

      if (ownerId !== user.id) {
        return ctx.forbidden("So podes remover favoritos da tua conta.");
      }
    }

    return super.delete(ctx);
  },
}));

async function findFavorito(strapi: any, id: string) {
  const byDocumentId = await strapi.db.query("api::favorito.favorito").findOne({
    where: { documentId: id },
    populate: ["user"],
  });

  if (byDocumentId) {
    return byDocumentId;
  }

  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return null;
  }

  return strapi.db.query("api::favorito.favorito").findOne({
    where: { id: numericId },
    populate: ["user"],
  });
}

async function findTeam(strapi: any, value: string | number) {
  if (!value) return null;

  const numericId = Number(value);
  if (Number.isFinite(numericId)) {
    const byId = await strapi.db.query("api::team.team").findOne({
      where: { id: numericId },
    });

    if (byId) {
      return byId;
    }
  }

  return strapi.db.query("api::team.team").findOne({
    where: { documentId: String(value) },
  });
}

async function findFavoriteByUserAndTeam(strapi: any, userId: number, teamId: number) {
  const favoritos = await strapi.db.query("api::favorito.favorito").findMany({
    where: { user: userId },
    populate: ["team", "user"],
  });

  return favoritos.find((favorito: { team?: { id?: number } }) => favorito.team?.id === teamId);
}

async function removeDuplicateFavorites(strapi: any, favoritos: any[]) {
  const seen = new Set();
  const unique = [];

  for (const favorito of favoritos) {
    const key = `${favorito.user?.id || "admin"}:${favorito.team?.id || favorito.id}`;

    if (seen.has(key)) {
      await strapi.db.query("api::favorito.favorito").delete({
        where: { id: favorito.id },
      });
      continue;
    }

    seen.add(key);
    unique.push(favorito);
  }

  return unique;
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
