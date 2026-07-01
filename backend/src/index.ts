import type { Core } from "@strapi/strapi";

const PUBLIC_ACTIONS = ["find", "findOne"];
const ADMIN_ACTIONS = ["find", "findOne", "create", "update", "delete"];
const WRITE_ACTIONS = ["create", "update", "delete"];
const CRUD_CONTENT_TYPES = ["team", "estadio", "jogo", "favorito"];
const AUTHENTICATED_FAVORITO_ACTIONS = ["api::favorito.favorito.create", "api::favorito.favorito.delete"];
const USER_ME_ACTION = "plugin::users-permissions.user.me";

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
      findOrCreateAdminRole(strapi),
    ]);

    const [publicRole, authenticatedRole, adminRole] = roles;

    if (!publicRole || !authenticatedRole || !adminRole) {
      return;
    }

    await removeWritePermissions(strapi, publicRole.id);
    await removeWritePermissions(strapi, authenticatedRole.id);
    await ensureRolePermissions(
      strapi,
      publicRole,
      buildActions(CRUD_CONTENT_TYPES, PUBLIC_ACTIONS)
    );
    await ensureRolePermissions(
      strapi,
      authenticatedRole,
      [
        ...buildActions(CRUD_CONTENT_TYPES, PUBLIC_ACTIONS),
        ...AUTHENTICATED_FAVORITO_ACTIONS,
        USER_ME_ACTION,
      ]
    );
    await ensureRolePermissions(
      strapi,
      adminRole,
      [...buildActions(CRUD_CONTENT_TYPES, ADMIN_ACTIONS), USER_ME_ACTION]
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
  role: { id: number | string; permissions?: { action: string }[] },
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

async function removeWritePermissions(strapi: Core.Strapi, roleId: number | string) {
  const writeActions = buildActions(CRUD_CONTENT_TYPES, WRITE_ACTIONS);

  await strapi.db.query("plugin::users-permissions.permission").deleteMany({
    where: {
      role: roleId,
      action: {
        $in: writeActions,
      },
    },
  });
}

async function findOrCreateAdminRole(strapi: Core.Strapi) {
  const existingRole = await strapi.db.query("plugin::users-permissions.role").findOne({
    where: { type: "admin" },
    populate: ["permissions"],
  });

  if (existingRole) {
    return existingRole;
  }

  return strapi.db.query("plugin::users-permissions.role").create({
    data: {
      name: "Admin",
      description: "Pode gerir os dados da aplicacao.",
      type: "admin",
    },
    populate: ["permissions"],
  });
}
