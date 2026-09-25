import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const {
      fullName,
      username,
      email,
      phone,
      password,
      confirmPassword,
    } = registerDto;

    if (password !== confirmPassword) {
      throw new ConflictException('Passwords do not match');
    }

    const existingUser = await this.usersRepository.findOne({
      where: [{ username }, { email }, { phone }],
    });

    if (existingUser) {
      throw new ConflictException(
        'Username, email, or phone already exists',
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = this.usersRepository.create({
      fullName,
      username,
      email,
      phone,
      passwordHash,
    });

    const savedUser = await this.usersRepository.save(user);

    const { passwordHash: _, ...safeUser } = savedUser;

    return safeUser;
  }

  async login(loginDto: LoginDto) {
    const { identifier, password } = loginDto;

    const user = await this.usersRepository.findOne({
      where: [{ email: identifier }, { username: identifier }],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
    });

    const { passwordHash: _, ...safeUser } = user;

    return {
      user: safeUser,
      accessToken,
    };
  }
}
