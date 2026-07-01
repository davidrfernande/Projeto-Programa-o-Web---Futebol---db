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
      populate: ["team"],
      orderBy: { createdAt: "desc" },
    });

    ctx.body = {
      data: favoritos,
      meta: {},
    };
  },

  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("Precisas de iniciar sessao para adicionar favoritos.");
    }

    ctx.request.body = {
      data: {
        ...(ctx.request.body?.data || {}),
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
