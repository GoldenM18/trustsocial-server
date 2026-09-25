import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';

import { DiscoverUsersDto } from './dto/discover-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from './entities/user.entity';
import {
  ProfilePhotoFile,
  ProfilePhotoStorage,
} from './storage/profile-photo-storage';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly profilePhotoStorage: ProfilePhotoStorage,
  ) {}

  async findMe(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        phone: true,
        profilePhotoUrl: true,
        isVerified: true,
        isOnline: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      profilePhotoUrl: user.profilePhotoUrl,
      isVerified: user.isVerified,
      isOnline: user.isOnline,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const current = await this.findMe(userId);

    if (dto.username !== undefined && dto.username !== current.username) {
      const existingUsername = await this.usersRepository.findOne({
        where: { username: dto.username },
        select: { id: true },
      });

      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    if (dto.phone !== undefined && dto.phone !== current.phone) {
      const existingPhone = await this.usersRepository.findOne({
        where: { phone: dto.phone },
        select: { id: true },
      });

      if (existingPhone) {
        throw new ConflictException('Phone already exists');
      }
    }

    const updates: Partial<Pick<User, 'fullName' | 'username' | 'phone'>> = {};

    if (dto.fullName !== undefined) {
      updates.fullName = dto.fullName;
    }

    if (dto.username !== undefined) {
      updates.username = dto.username;
    }

    if (dto.phone !== undefined) {
      updates.phone = dto.phone;
    }

    if (Object.keys(updates).length === 0) {
      return current;
    }

    await this.usersRepository.update(userId, updates);

    return this.findMe(userId);
  }

  async updateProfilePhoto(
    userId: string,
    file: ProfilePhotoFile,
    publicBaseUrl: string,
  ) {
    await this.findMe(userId);

    const profilePhotoUrl = await this.profilePhotoStorage.save(
      file,
      publicBaseUrl,
    );

    await this.usersRepository.update(userId, { profilePhotoUrl });

    return this.findMe(userId);
  }

  async discover(userId: string, query: DiscoverUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const identity = { id: Not(userId) };
    const where = search
      ? [
          { ...identity, fullName: ILike(toSearchPattern(search)) },
          { ...identity, username: ILike(toSearchPattern(search)) },
        ]
      : identity;

    const [users, total] = await this.usersRepository.findAndCount({
      where,
      select: {
        id: true,
        fullName: true,
        username: true,
        profilePhotoUrl: true,
        isVerified: true,
        isOnline: true,
        createdAt: true,
      },
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        profilePhotoUrl: user.profilePhotoUrl,
        isVerified: user.isVerified,
        isOnline: user.isOnline,
      })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async findPublicProfile(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        username: true,
        profilePhotoUrl: true,
        isVerified: true,
        isOnline: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      profilePhotoUrl: user.profilePhotoUrl,
      isVerified: user.isVerified,
      isOnline: user.isOnline,
      createdAt: user.createdAt,
    };
  }
}

function toSearchPattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}
