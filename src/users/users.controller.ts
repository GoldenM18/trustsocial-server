import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DiscoverUsersDto } from './dto/discover-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  type ProfilePhotoFile,
  profilePhotoUploadOptions,
} from './storage/profile-photo-storage';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.findMe(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateMe(request.user.userId, updateProfileDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/photo')
  @UseInterceptors(FileInterceptor('photo', profilePhotoUploadOptions))
  uploadPhoto(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: ProfilePhotoFile,
  ) {
    if (!file) {
      throw new BadRequestException('A profile image is required');
    }

    const host = request.get('host');
    const publicBaseUrl = host
      ? `${request.protocol}://${host}`
      : `http://localhost:${process.env.PORT ?? 3000}`;

    return this.usersService.updateProfilePhoto(
      request.user.userId,
      file,
      publicBaseUrl,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('discover')
  discover(
    @Req() request: AuthenticatedRequest,
    @Query() query: DiscoverUsersDto,
  ) {
    return this.usersService.discover(request.user.userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findPublicProfile(id);
  }
}
