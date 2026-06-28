import type { Core } from '@strapi/strapi';

const PUBLIC_CRUD_ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'];
const PUBLIC_CRUD_CONTENT_TYPES = ['team', 'estadio', 'jogo', 'favorito'];

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'public' },
      populate: ['permissions'],
    });

    if (!publicRole) {
      return;
    }

    const existingActions = new Set(
      (publicRole.permissions || []).map((permission: { action: string }) => permission.action)
    );

    const permissionsToCreate = PUBLIC_CRUD_CONTENT_TYPES.flatMap((contentType) =>
      PUBLIC_CRUD_ACTIONS.map((action) => `api::${contentType}.${contentType}.${action}`)
    ).filter((action) => !existingActions.has(action));

    await Promise.all(
      permissionsToCreate.map((action) =>
        strapi.db.query('plugin::users-permissions.permission').create({
          data: {
            action,
            role: publicRole.id,
          },
        })
      )
    );
  },
};
