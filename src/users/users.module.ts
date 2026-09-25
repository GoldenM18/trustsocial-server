import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { LocalProfilePhotoStorage } from './storage/local-profile-photo.storage';
import { ProfilePhotoStorage } from './storage/profile-photo-storage';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: ProfilePhotoStorage,
      useClass: LocalProfilePhotoStorage,
    },
  ],
  exports: [TypeOrmModule],
})
export class UsersModule {}
