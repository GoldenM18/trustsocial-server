import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto } from './dto/create-connection.dto';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('requests')
  listIncoming(@Req() request: AuthenticatedRequest) {
    return this.connectionsService.listIncoming(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sent')
  listOutgoing(@Req() request: AuthenticatedRequest) {
    return this.connectionsService.listOutgoing(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.connectionsService.listAccepted(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() createConnectionDto: CreateConnectionDto,
  ) {
    return this.connectionsService.createRequest(
      request.user.userId,
      createConnectionDto.recipientId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/accept')
  accept(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connectionsService.accept(request.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/reject')
  reject(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connectionsService.reject(request.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connectionsService.cancel(request.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connectionsService.remove(request.user.userId, id);
  }
}
