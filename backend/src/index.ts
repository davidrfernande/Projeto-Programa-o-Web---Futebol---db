import type { Core } from "@strapi/strapi";

const PUBLIC_ACTIONS = ["find", "findOne"];
const AUTHENTICATED_ACTIONS = ["find", "findOne", "create", "update", "delete"];
const WRITE_ACTIONS = ["create", "update", "delete"];
const PUBLIC_CRUD_CONTENT_TYPES = ['team', 'estadio', 'jogo', 'favorito'];

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const roles = await Promise.all([
      strapi.db.query("plugin::users-permissions.role").findOne({
        where: { type: "public" },
        populate: ["permissions"],
      }),
      strapi.db.query("plugin::users-permissions.role").findOne({
        where: { type: "authenticated" },
        populate: ["permissions"],
      }),
    ]);

    const [publicRole, authenticatedRole] = roles;

    if (!publicRole || !authenticatedRole) {
      return;
    }

    await removePublicWritePermissions(strapi, publicRole.id);
    await ensureRolePermissions(
      strapi,
      publicRole,
      buildActions(PUBLIC_CRUD_CONTENT_TYPES, PUBLIC_ACTIONS)
    );
    await ensureRolePermissions(
      strapi,
      authenticatedRole,
      buildActions(PUBLIC_CRUD_CONTENT_TYPES, AUTHENTICATED_ACTIONS)
    );
  },
};

function buildActions(contentTypes: string[], actions: string[]) {
  return contentTypes.flatMap((contentType) =>
    actions.map((action) => `api::${contentType}.${contentType}.${action}`)
  );
}

async function ensureRolePermissions(
  strapi: Core.Strapi,
  role: { id: number; permissions?: { action: string }[] },
  actions: string[]
) {
  const existingActions = new Set(
    (role.permissions || []).map((permission: { action: string }) => permission.action)
  );

  const permissionsToCreate = actions.filter((action) => !existingActions.has(action));

  await Promise.all(
    permissionsToCreate.map((action) =>
      strapi.db.query("plugin::users-permissions.permission").create({
        data: {
          action,
          role: role.id,
        },
      })
    )
  );
}

async function removePublicWritePermissions(strapi: Core.Strapi, publicRoleId: number) {
  const publicWriteActions = buildActions(PUBLIC_CRUD_CONTENT_TYPES, WRITE_ACTIONS);

  await strapi.db.query("plugin::users-permissions.permission").deleteMany({
    where: {
      role: publicRoleId,
      action: {
        $in: publicWriteActions,
      },
    },
  });
}
