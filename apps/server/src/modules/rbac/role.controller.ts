import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { RoleType } from '@lunar/shared'
import { ArrayNotEmpty, IsArray, IsOptional, IsString, Length } from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { RbacService } from './rbac.service'

class CreateRoleDto {
  @IsString()
  @Length(2, 64)
  name!: string

  @IsString()
  @Length(2, 64)
  code!: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string
}

class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string
}

class AssignPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[]
}

class AssignUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleCodes!: string[]
}

@ApiTags('管理员端 - 角色权限')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class RoleController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '角色列表' })
  async listRoles() {
    const roles = await this.rbacService.listRoles()
    return roles.map((role) => this.toRoleVo(role))
  }

  @Get('roles/:id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '角色详情（含权限点）' })
  async getRole(@Param('id') id: string) {
    const role = await this.rbacService.getRoleDetail(id)
    return {
      id: role.id.toString(),
      name: role.name,
      code: role.code,
      description: role.description,
      isSystem: role.isSystem,
      permissionCodes: role.permissionCodes,
    }
  }

  @Post('roles')
  @RequirePermissions('user:create')
  @Auditable({ module: 'rbac', action: 'create_role', targetType: 'role' })
  @ApiOperation({ summary: '创建角色' })
  async createRole(@Body() dto: CreateRoleDto) {
    const role = await this.rbacService.createRole(dto)
    return { id: role.id.toString() }
  }

  @Put('roles/:id')
  @RequirePermissions('user:update')
  @Auditable({ module: 'rbac', action: 'update_role', targetType: 'role' })
  @ApiOperation({ summary: '更新角色' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const role = await this.rbacService.updateRole(id, dto)
    return { id: role.id.toString() }
  }

  @Delete('roles/:id')
  @RequirePermissions('user:delete')
  @Auditable({ module: 'rbac', action: 'delete_role', targetType: 'role' })
  @ApiOperation({ summary: '删除角色' })
  async removeRole(@Param('id') id: string) {
    return this.rbacService.removeRole(id)
  }

  @Get('permissions')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '权限点列表' })
  async listPermissions() {
    const permissions = await this.rbacService.listPermissions()
    return permissions.map((permission) => ({
      id: permission.id.toString(),
      name: permission.name,
      code: permission.code,
      resource: permission.resource,
      action: permission.action,
    }))
  }

  @Put('roles/:id/perms')
  @RequirePermissions('user:update')
  @Auditable({ module: 'rbac', action: 'assign_permissions', targetType: 'role' })
  @ApiOperation({ summary: '分配角色权限' })
  async assignPermissions(@Param('id') id: string, @Body() dto: AssignPermissionsDto) {
    return this.rbacService.assignPermissions(id, dto.permissionCodes)
  }

  @Put('users/:id/roles')
  @RequirePermissions('user:update')
  @Auditable({ module: 'rbac', action: 'assign_user_roles', targetType: 'user' })
  @ApiOperation({ summary: '分配用户角色' })
  async assignUserRoles(@Param('id') id: string, @Body() dto: AssignUserRolesDto) {
    return this.rbacService.assignUserRoles(id, dto.roleCodes)
  }

  private toRoleVo(role: {
    id: bigint
    name: string
    code: string
    description: string | null
    isSystem: number
    createdAt: Date
    _count?: { permissions: number; users: number }
  }) {
    return {
      id: role.id.toString(),
      name: role.name,
      code: role.code,
      description: role.description,
      isSystem: role.isSystem,
      permissionCount: role._count?.permissions ?? 0,
      userCount: role._count?.users ?? 0,
      createdAt: role.createdAt,
    }
  }
}
